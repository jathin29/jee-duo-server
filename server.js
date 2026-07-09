// JEE Duo — standalone 24/7 server
// Serves the static app and replaces the two things that only worked
// inside a Claude.ai artifact sandbox:
//   1) window.storage  -> a real JSON-file key/value store on disk (/api/kv/*)
//   2) direct browser call to api.anthropic.com -> a server-side proxy (/api/ai)
//      that holds the real API key, so it's never exposed to the browser.

require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const APP_USER = process.env.APP_USER || '';
const APP_PASS = process.env.APP_PASS || '';
const AI_RATE_LIMIT_PER_HOUR = parseInt(process.env.AI_RATE_LIMIT_PER_HOUR || '60', 10);

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '{}');

// ---------------- tiny durable KV store ----------------
// Loaded fully into memory (this app's data is small — todos, logs, chat,
// test scores for two people) and flushed to disk on every write via a
// serialized write queue so concurrent requests can't corrupt the file.
let store = {};
try {
  store = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8') || '{}');
} catch (e) {
  console.error('Could not parse data/store.json, starting fresh.', e);
  store = {};
}

let writeQueue = Promise.resolve();
function persist() {
  writeQueue = writeQueue.then(
    () =>
      new Promise((resolve) => {
        const tmp = DATA_FILE + '.tmp';
        fs.writeFile(tmp, JSON.stringify(store), (err) => {
          if (err) {
            console.error('Storage write failed:', err);
            return resolve();
          }
          fs.rename(tmp, DATA_FILE, (err2) => {
            if (err2) console.error('Storage rename failed:', err2);
            resolve();
          });
        });
      })
  );
  return writeQueue;
}

function kvGet(key) {
  return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
}
async function kvSet(key, value) {
  store[key] = value;
  await persist();
  return value;
}

// ---------------- basic auth (optional but recommended) ----------------
// Set APP_USER + APP_PASS in .env to keep this private to just the two of
// you. Without it, anyone with the URL can use it — including your
// Anthropic API quota.
function requireAuth(req, res, next) {
  if (!APP_USER || !APP_PASS) return next(); // auth disabled
  const hdr = req.headers.authorization || '';
  const [scheme, encoded] = hdr.split(' ');
  if (scheme === 'Basic' && encoded) {
    const [user, pass] = Buffer.from(encoded, 'base64').toString().split(':');
    if (user === APP_USER && pass === APP_PASS) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="JEE Duo"');
  return res.status(401).send('Authentication required.');
}

// ---------------- simple in-memory rate limit for the AI endpoint ----------------
let aiCallLog = [];
function underRateLimit() {
  const now = Date.now();
  const hourAgo = now - 60 * 60 * 1000;
  aiCallLog = aiCallLog.filter((t) => t > hourAgo);
  if (aiCallLog.length >= AI_RATE_LIMIT_PER_HOUR) return false;
  aiCallLog.push(now);
  return true;
}

// ---------------- app ----------------
const app = express();
app.use(express.json({ limit: '15mb' })); // images are base64 in the body
app.use(requireAuth);
app.use(express.static(path.join(__dirname, 'public')));

app.get('/healthz', (req, res) => res.status(200).send('ok'));

app.get('/api/kv/get', (req, res) => {
  const key = req.query.key;
  if (!key || typeof key !== 'string') return res.status(400).json({ error: 'key required' });
  res.json({ key, value: kvGet(key) });
});

app.post('/api/kv/set', async (req, res) => {
  const { key, value } = req.body || {};
  if (!key || typeof key !== 'string') return res.status(400).json({ error: 'key required' });
  if (typeof value !== 'string') return res.status(400).json({ error: 'value must be a string' });
  if (key.length > 300) return res.status(400).json({ error: 'key too long' });
  if (value.length > 5_000_000) return res.status(400).json({ error: 'value too large' });
  await kvSet(key, value);
  res.json({ key, value });
});

app.post('/api/ai', async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY. Add it to .env and restart.' });
  }
  if (!underRateLimit()) {
    return res.status(429).json({ error: 'AI request limit reached for this hour. Try again shortly.' });
  }
  const { prompt, image } = req.body || {};
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'prompt required' });
  }

  const content = [];
  if (image && typeof image === 'string') {
    const match = image.match(/^data:(image\/[a-zA-Z]+);base64,(.*)$/);
    if (match) {
      content.push({ type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } });
    }
  }
  content.push({ type: 'text', text: prompt });

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 1000,
        messages: [{ role: 'user', content }],
      }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      console.error('Anthropic API error:', data);
      return res.status(resp.status).json({ error: (data && data.error && data.error.message) || 'Anthropic API error' });
    }
    const text = (data.content || []).map((c) => c.text || '').join('\n').trim();
    res.json({ text });
  } catch (err) {
    console.error('AI proxy request failed:', err);
    res.status(502).json({ error: 'Could not reach the Anthropic API.' });
  }
});

// Anything else that isn't a static file or an API route -> the app shell.
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`JEE Duo server running on http://localhost:${PORT}`);
  if (!ANTHROPIC_API_KEY) {
    console.warn('⚠️  ANTHROPIC_API_KEY not set — Ask AI tutor / Insights / Syllabus planner will fail until you add it to .env.');
  }
  if (!APP_USER || !APP_PASS) {
    console.warn('⚠️  APP_USER/APP_PASS not set — this server is open to anyone with the URL. Set them in .env to password-protect it.');
  }
});
