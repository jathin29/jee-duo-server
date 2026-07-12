require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const Groq = require('groq-sdk');

const app = express();
app.use(express.json({ limit: '15mb' }));

const GROQ_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';

function requireAppAuth(req, res, next) {
  const appUser = process.env.APP_USER;
  const appPass = process.env.APP_PASS;
  if (!appUser || !appPass) return next();

  const auth = req.headers.authorization || '';
  const [scheme, encoded] = auth.split(' ');
  if (scheme !== 'Basic' || !encoded) {
    res.set('WWW-Authenticate', 'Basic realm="JEE Duo"');
    return res.status(401).send('Authentication required');
  }

  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  const user = separator >= 0 ? decoded.slice(0, separator) : '';
  const pass = separator >= 0 ? decoded.slice(separator + 1) : '';

  if (user !== appUser || pass !== appPass) {
    res.set('WWW-Authenticate', 'Basic realm="JEE Duo"');
    return res.status(401).send('Authentication required');
  }

  next();
}

app.use(requireAppAuth);

const AI_RATE_WINDOW_MS = Number(process.env.AI_RATE_WINDOW_MS || 60 * 1000);
const AI_RATE_MAX = Number(process.env.AI_RATE_MAX || 20);
const aiRateBuckets = new Map();

function aiRateLimit(req, res, next) {
  const key = req.ip || req.headers['x-forwarded-for'] || 'unknown';
  const now = Date.now();
  const bucket = aiRateBuckets.get(key) || { start: now, count: 0 };

  if (now - bucket.start >= AI_RATE_WINDOW_MS) {
    bucket.start = now;
    bucket.count = 0;
  }

  bucket.count += 1;
  aiRateBuckets.set(key, bucket);

  if (bucket.count > AI_RATE_MAX) {
    return res.status(429).json({ error: 'Too many AI requests. Please try again shortly.' });
  }

  next();
}

function toGroqContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content.map((part) => {
    if (!part || typeof part !== 'object') return null;
    if (part.type === 'text') {
      return { type: 'text', text: part.text || '' };
    }
    if (part.type === 'image' && part.source && part.source.type === 'base64') {
      const mediaType = part.source.media_type || 'image/jpeg';
      return {
        type: 'image_url',
        image_url: {
          url: `data:${mediaType};base64,${part.source.data || ''}`
        }
      };
    }
    if (part.type === 'image_url' && part.image_url) return part;
    return null;
  }).filter(Boolean);
}

function toGroqMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.map((message) => ({
    role: message.role === 'assistant' || message.role === 'system' ? message.role : 'user',
    content: toGroqContent(message.content)
  }));
}

// ---------------------------------------------------------------------------
// Storage: a tiny flat JSON key-value store on disk. Good enough for two
// people. If you outgrow this, swap loadStore/saveStore for a real database.
// ---------------------------------------------------------------------------
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'storage.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({}));

function loadStore() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch (e) { return {}; }
}

function saveStore(store) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(store));
}

app.post('/api/storage/get', (req, res) => {
  const { key } = req.body || {};
  if (!key) return res.status(400).json({ error: 'key required' });
  const store = loadStore();
  if (!(key in store)) return res.json(null);
  res.json({ key, value: store[key] });
});

app.post('/api/storage/set', (req, res) => {
  const { key, value } = req.body || {};
  if (!key) return res.status(400).json({ error: 'key required' });
  const store = loadStore();
  store[key] = value;
  saveStore(store);
  res.json({ key, value });
});

app.post('/api/storage/delete', (req, res) => {
  const { key } = req.body || {};
  if (!key) return res.status(400).json({ error: 'key required' });
  const store = loadStore();
  const existed = key in store;
  delete store[key];
  saveStore(store);
  res.json({ key, deleted: existed });
});

app.get('/api/storage/list', (req, res) => {
  const prefix = req.query.prefix || '';
  const store = loadStore();
  const keys = Object.keys(store).filter((k) => k.startsWith(prefix));
  res.json({ keys, prefix });
});

// ---------------------------------------------------------------------------
// AI proxy: the frontend calls /api/ai, and this is where the real Groq API
// key lives server-side. It accepts the existing frontend request shape and
// returns the same response shape, so no browser changes are required.
// ---------------------------------------------------------------------------
app.post('/api/ai', aiRateLimit, async (req, res) => {
  try {
    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({ error: 'GROQ_API_KEY is not set on the server (.env)' });
    }

    const { messages, max_tokens } = req.body || {};
    const groqMessages = toGroqMessages(messages);
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

    const completion = await groq.chat.completions.create({
      model: GROQ_MODEL,
      max_tokens: max_tokens || 1000,
      messages: groqMessages
    });

    const text = completion.choices?.[0]?.message?.content || '';
    res.json({
      id: completion.id,
      model: completion.model || GROQ_MODEL,
      content: [{ type: 'text', text }],
      usage: completion.usage
    });
  } catch (err) {
    console.error('AI proxy error:', err);
    const status = err.status || err.statusCode || 500;
    res.status(status).json({ error: err.message || 'AI request failed' });
  }
});

// ---------------------------------------------------------------------------
// Static frontend
// ---------------------------------------------------------------------------
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`JEE Duo server running on port ${PORT}`);
});
