# JEE Duo — standalone server

This turns your `jee-duo.html` artifact into a real, self-hosted web app
that runs 24/7, not just inside a claude.ai tab.

Two things only worked inside the Claude.ai artifact sandbox, and this
project replaces both:

| In the artifact | Here |
|---|---|
| `window.storage` (Claude.ai's built-in save/load) | A small JSON file on disk (`data/store.json`), served through `/api/kv/get` and `/api/kv/set` |
| Browser calling `api.anthropic.com` directly with no key | Browser calls **your own server** at `/api/ai`, which holds the real Anthropic API key and calls Anthropic itself. The key never reaches the browser. |

The frontend (`public/index.html`) is your original file with just those
two call sites rewired — everything else (timer, columns, charts, mock
test tracker, doubt chat, AI coach) is untouched.

## 1. Get an API key

Create a key at https://console.anthropic.com/settings/keys — you're now
paying per request (this app used to run on Claude.ai's own quota; now it
runs on yours), so also set `AI_RATE_LIMIT_PER_HOUR` below to something
sane for two people.

## 2. Configure

```bash
cp .env.example .env
```

Edit `.env`:

```
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-5
PORT=3000
APP_USER=jathin
APP_PASS=pick-a-real-password
AI_RATE_LIMIT_PER_HOUR=60
```

`APP_USER` / `APP_PASS` put the entire site behind a single shared
username/password (HTTP Basic Auth) — recommended, since without it anyone
who guesses/finds the URL can burn your API credits. Leave both blank only
if you're running this purely on localhost.

## 3. Run it

**Plain Node:**
```bash
npm install
npm start
```
Visit `http://localhost:3000`.

**Docker (recommended for a VPS):**
```bash
docker compose up -d --build
```
This restarts automatically on crash or reboot (`restart: unless-stopped`)
and keeps your data in `./data` on the host, outside the container.

## 4. Keep it running 24/7

Running `npm start` in a terminal stops the moment you close that terminal.
For "always on" you need it running on something that stays on — this
sandbox can't host a public 24/7 server for you, but any of these will:

- **Docker Compose on a small VPS** (Hetzner, DigitalOcean, Linode, etc.) —
  `docker compose up -d`, and `restart: unless-stopped` handles crashes and
  reboots for you. This is the path this repo is set up for.
- **systemd**, if you're running plain Node on a VPS without Docker — see
  `jee-duo.service.example` for a ready-to-copy unit file.
- **A PaaS** like Railway, Render, or Fly.io — push this repo, set the same
  env vars in their dashboard, and point a persistent volume at `/app/data`
  (or switch to their managed Postgres/SQLite add-on if you want to skip
  volumes entirely — ask me if you'd like that version instead).
- **pm2**, if you want process supervision without systemd/Docker:
  `npm i -g pm2 && pm2 start server.js --name jee-duo && pm2 save && pm2 startup`.

Whichever you pick, put it behind HTTPS (a reverse proxy like Caddy or
Nginx, or your PaaS's built-in TLS) before sharing the URL with your study
partner — Basic Auth credentials go in cleartext over plain HTTP.

## 5. Data & backups

All study data (timer logs, todos, mock test scores, chat, insights) lives
in `data/store.json`, keyed by your room code. Back that file up
periodically (`cp data/store.json backup-$(date +%F).json`) — losing it
means losing your history.

## Project layout

```
server.js              Express server: static hosting + /api/kv + /api/ai
public/index.html       Your original app, rewired to call the server
data/store.json          Room data (created automatically)
.env.example             Copy to .env and fill in
Dockerfile / docker-compose.yml   Containerized 24/7 deployment
jee-duo.service.example  systemd unit for a bare VPS
```
