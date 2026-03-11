# Self-Healing Code

An Express + TypeScript API that accepts error reports and runs an automated self-healing pipeline. When you report an error with a source repository URL and branch, the service clones the repo, investigates the failure, applies fixes, and opens a pull request.

**Language support:** Currently supports **Node.js** codebases only. Python, Rust, and Go support coming soon.

## Features

- **POST /error** — Submit error reports (message, stack, source URL, branch). Returns `202` with a job ID for async processing.
- **SQLite job queue** — Durable, in-process queue. Jobs survive restarts. Duplicate reports (same fingerprint) are deduplicated. Stale jobs (processing > 10 min) are auto-reclaimed.
- **Self-healing pipeline** — For each job: clone repo → install deps → investigate → fix → commit & push → open PR (via Cursor agent CLI).
- **Queue inspection** — `GET /queue` lists jobs with stats and optional status filter. `POST /queue/trigger` manually kicks the worker.

## Requirements

- Node.js 20+
- TypeScript
- Git (for cloning repos)
- Cursor agent CLI (for the fix pipeline; used when running in Docker)

## Quick Start

```bash
# Install dependencies
npm install

# Copy env example and configure
cp .env.example .env

# Development
npm run dev

# Production build
npm run build
npm start
```

## API

| Method | Path            | Description                                   |
|--------|-----------------|-----------------------------------------------|
| GET    | `/`             | Health-style hello                            |
| GET    | `/health`       | Health check (`{ status: "ok" }`)            |
| POST   | `/error`        | Submit an error report                        |
| GET    | `/queue`        | Queue stats + list jobs (`?limit=50&status=pending`) |
| POST   | `/queue/trigger`| Manually trigger worker to process next job   |

### POST /error

**Body (JSON):**

```json
{
  "message": "TypeError: Cannot read property 'x' of undefined",
  "stack": "at foo.js:10:5\n...",
  "source": "https://github.com/user/repo.git",
  "branch": "main",
  "timestamp": "2025-03-11T12:00:00Z",
  "metadata": {}
}
```

**Required:** `message`, `branch`, `source` (source is required for the pipeline).

**Response:** `202 Accepted` with `{ accepted: true, jobId: number }`.

### GET /queue

Query params: `limit` (default 50, max 200), `status` (optional: `pending`, `processing`, `done`, `failed`).

**Response:** `{ stats: { pending, processing, done, failed, total }, finished: boolean, jobs: [...] }`.

### POST /queue/trigger

Kicks the worker loop immediately (useful when queue has pending work but worker is idle).

**Response:** `{ triggered: boolean, message: string, stats }`.

## Environment Variables

See [.env.example](.env.example) for all options. Key variables:

- `PORT` — Server port (default `3000`)
- `NODE_ENV` — `development` or `production`
- `LOG_LEVEL` — `debug`, `info`, `warn`, `error` (default `info`)

For Docker/pipeline: `CURSOR_API_KEY`, `GIT_TOKEN`, `GIT_URL` (optional; custom Git host), and `GIT_AUTHOR_NAME` / `GIT_AUTHOR_EMAIL` / `GIT_COMMITTER_NAME` / `GIT_COMMITTER_EMAIL`.

## Docker

```bash
# Build
docker build -t self-healing-code .

# Run (set CURSOR_API_KEY and GIT_TOKEN for full pipeline)
docker run -p 3000:3000 \
  -e CURSOR_API_KEY=your-key \
  -e GIT_TOKEN=ghp_xxx \
  -v self-healing-data:/app/data \
  self-healing-code
```

**With docker-compose** (recommended; persists queue DB automatically):

```bash
docker compose up -d
# Set CURSOR_API_KEY, GIT_TOKEN, GIT_AUTHOR_* via .env or -e
```

The container includes Cursor agent CLI, Git, GitHub CLI (`gh`), and GitLab CLI (`glab`). Jobs clone repos into `workspace/` and the queue DB is at `data/queue.db`.

## Project Structure

```
src/
├── index.ts          # Express app, routes, worker loop, /queue endpoints
├── queue/db.ts       # SQLite queue (enqueue, claimNext, setStatus, listQueueJobs, getQueueStats)
├── schemas/errorReport.ts
└── utils/
    ├── errorHandler.ts  # Pipeline (clone, agent steps) & handleError
    ├── fingerprint.ts   # Deduplication fingerprint (message + stack + source + branch)
    └── logger.ts
```

## License

ISC
