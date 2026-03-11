# Self-Healing Code

An Express + TypeScript API that accepts error reports and runs an automated self-healing pipeline. When you report an error with a source repository URL and branch, the service clones the repo, investigates the failure, applies fixes, and opens a pull request.

**Language support:** Currently supports **Node.js** codebases only. Python, Rust, and Go support coming soon.

## Features

- **POST /error** — Submit error reports (message, stack, source URL, branch). Returns `202` with a job ID for async processing.
- **SQLite job queue** — Durable, in-process queue. Jobs survive restarts. Duplicate reports (same fingerprint) are deduplicated.
- **Self-healing pipeline** — For each job: clone repo → install deps → investigate → fix → commit & push → open PR (via Cursor agent CLI).

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

| Method | Path     | Description                        |
|--------|----------|------------------------------------|
| GET    | `/`      | Health-style hello                 |
| GET    | `/health`| Health check (`{ status: "ok" }`)  |
| POST   | `/error` | Submit an error report             |

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

## Environment Variables

See [.env.example](.env.example) for all options. Key variables:

- `PORT` — Server port (default `3000`)
- `NODE_ENV` — `development` or `production`
- `LOG_LEVEL` — `debug`, `info`, `warn`, `error` (default `info`)

For Docker: `CURSOR_API_KEY`, `GIT_TOKEN`, and Git identity vars for the pipeline.

## Docker

```bash
# Build
docker build -t self-healing-code .

# Run (set CURSOR_API_KEY and GIT_TOKEN for full pipeline)
docker run -p 3000:3000 \
  -e CURSOR_API_KEY=your-key \
  -e GIT_TOKEN=ghp_xxx \
  self-healing-code
```

The container includes Cursor agent CLI and Git. Jobs clone repos into `workspace/` and the queue DB is at `data/queue.db`.

## Project Structure

```
src/
├── index.ts          # Express app, routes, worker loop
├── queue/db.ts       # SQLite queue (enqueue, claimNext, setStatus)
├── schemas/errorReport.ts
└── utils/
    ├── errorHandler.ts  # Pipeline (clone, agent steps) & handleError
    ├── fingerprint.ts   # Deduplication fingerprint
    └── logger.ts
```

## License

ISC
