# JEE Duo - standalone server

This turns your `jee-duo.html` artifact into a real, self-hosted web app
that runs 24/7.

The server provides two pieces the browser app needs:

| Browser need | Server support |
|---|---|
| `window.storage` style save/load | A small JSON file on disk (`data/store.json`), served through `/api/kv/get` and `/api/kv/set` |
| AI calls without exposing a secret key | Browser calls this server at `/api/ai`; the server calls Groq with `GROQ_API_KEY` |

The frontend (`public/index.html`) keeps calling the same `/api/ai` and
`/api/kv/*` endpoints, so no frontend changes are needed.

## 1. Get an API key

Create a key at https://console.groq.com/keys. The server uses Groq's
official SDK and the fixed model:

```
meta-llama/llama-4-scout-17b-16e-instruct
```

Set `AI_RATE_LIMIT_PER_HOUR` below to something sane for two people.

## 2. Configure

```bash
cp .env.example .env
```

Edit `.env`:

```
GROQ_API_KEY=gsk_...
PORT=3000
APP_USER=jathin
APP_PASS=pick-a-real-password
AI_RATE_LIMIT_PER_HOUR=60
```

`APP_USER` / `APP_PASS` put the entire site behind a single shared
username/password (HTTP Basic Auth). Leave both blank only if you're
running this purely on localhost.

## 3. Run it

Plain Node:

```bash
npm install
npm start
```

Visit `http://localhost:3000`.

Docker:

```bash
docker compose up -d --build
```

This restarts automatically on crash or reboot (`restart: unless-stopped`)
and keeps your data in `./data` on the host, outside the container.

## 4. Deploy on Render

Create a Render Web Service from this repository.

- Build command: `npm install`
- Start command: `npm start`
- Environment variables: `GROQ_API_KEY`, `APP_USER`, `APP_PASS`, and optionally `AI_RATE_LIMIT_PER_HOUR`

If you want the JSON data to survive redeploys and restarts, attach a
persistent disk mounted at `/app/data`. Without a disk, Render's filesystem
can reset and `data/store.json` may be lost.

## 5. Keep it running 24/7 elsewhere

Running `npm start` in a terminal stops when you close that terminal. For
"always on" hosting, use something that stays on:

- Docker Compose on a small VPS: `docker compose up -d`
- systemd on a VPS: see `jee-duo.service.example`
- A PaaS like Render, Railway, or Fly.io
- pm2: `npm i -g pm2 && pm2 start server.js --name jee-duo && pm2 save && pm2 startup`

Whichever you pick, put it behind HTTPS before sharing the URL.

## 6. Data & backups

All study data lives in `data/store.json`, keyed by your room code. Back
that file up periodically.

## Project layout

```
server.js              Express server: static hosting + /api/kv + /api/ai
public/index.html      Your original app, rewired to call the server
data/store.json        Room data
.env.example           Copy to .env and fill in
Dockerfile             Container image
docker-compose.yml     Local/VPS container runner
jee-duo.service.example systemd unit for a bare VPS
```
