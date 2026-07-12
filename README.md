# JEE Duo

A private, two-person accountability app for JEE prep: live study timer,
Pomodoro mode, shared to-do lists, streaks and leaderboard, shared notes, a
doubt chat with an AI tutor, an AI syllabus-to-tasks planner, and a mock test
tracker.

This is the self-hosted version: a small Node/Express server plus a static
frontend. It is ready to run on Render.

## Project structure

```
server.js            Express server: static hosting + storage API + Groq AI proxy
public/index.html    The entire frontend (single file)
data/                Where the JSON key-value store lives on disk
.env.example         Template for required environment variables
Dockerfile           Container build
docker-compose.yml   Local/self-hosted container run
jee-duo.service.example  Optional systemd unit for a bare VPS
```

## Local setup

```bash
npm install
cp .env.example .env
# edit .env and set GROQ_API_KEY to a real key
npm start
```

Then open `http://localhost:3000`. Running `npm install` for the first time
will also generate `package-lock.json`; commit that file to your repo.

Give your friend the same URL once deployed, and make sure you both use the
same room code but different names when you log in.

## Deploying to Render

1. Push this project to a GitHub repo.
2. On Render: New Web Service, then connect the repo.
3. Build command: `npm install`
4. Start command: `npm start`
5. Add environment variables from `.env.example`, at minimum `GROQ_API_KEY`.
6. Optional: set `APP_USER` and `APP_PASS` to protect the whole app with a
   browser login.
7. Persistence matters: Render's free web services use an ephemeral filesystem.
   Anything in `data/storage.json` will be wiped on redeploy or restart. To keep
   your study history, streaks, and notes across deploys, attach a Render Disk
   mounted at `/app/data`, or swap the storage layer for a real database.

## AI provider

All AI calls go through `/api/ai` in `server.js`; the browser never talks to
Groq directly, and the API key never leaves the server. The app uses Groq's
official SDK with this model:

```
meta-llama/llama-4-scout-17b-16e-instruct
```

The frontend still sends the same `/api/ai` request shape as before, including
base64 image uploads. The server converts those messages to Groq's chat format
and returns the same response shape expected by the existing UI.

`AI_RATE_WINDOW_MS` and `AI_RATE_MAX` can be used to tune the AI-only rate
limit. If unset, the default is 20 AI requests per minute per client.

## Docker

```bash
docker compose up --build
```

Mounts `./data` as a volume so your storage survives container restarts.

## Notes on how storage works

The frontend calls `/api/storage/get|set|delete` and `/api/storage/list`, which
read/write a single flat JSON file (`data/storage.json`) on the server. The
storage API has not been changed.
