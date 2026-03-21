# Self-Healing Code

An Express + TypeScript API that accepts error reports and runs an automated self-healing pipeline. When you report an error with a source repository URL and branch, the service clones the repo, investigates the failure, applies fixes, and opens a pull request.

**Language support:** Currently supports **Node.js** codebases only. Python, Rust, and Go support coming soon.

## Features

- **POST /error** — Submit error reports (message, stack, source URL, branch). Returns `202` with a job ID for async processing.
- **SQLite job queue** — Durable, in-process queue. Jobs survive restarts. Duplicate reports (same fingerprint) are deduplicated. Stale jobs (processing > 10 min) are auto-reclaimed.
- **Self-healing pipeline** — For each job: clone repo → install deps → investigate → fix → commit & push → open PR (via Cursor agent CLI).
- **Queue inspection** — `GET /queue` lists jobs with stats and optional status filter. `POST /queue/trigger` manually kicks the worker.
- **Workspace cleanup** — Auto-deletion of clone dirs older than 2 days (configurable). `GET /workspace` lists entries; `POST /workspace/cleanup` runs cleanup on demand (optional `retentionDays`, `dryRun`).
- **OAuth 2.0 (optional)** — When `OAUTH_JWT_SECRET` and `OAUTH_CLIENTS` are set, other services use **client credentials** (`POST /oauth/token`) and send `Authorization: Bearer <token>` on protected routes. `GET /`, `GET /health`, `GET /openapi.json`, `GET /reference`, and `POST /oauth/token` stay unauthenticated.
- **API docs (Scalar)** — Interactive OpenAPI UI at **`/reference`** (loads spec from **`/openapi.json`**). Same stack as [Scalar](https://scalar.com/)’s CDN integration; no extra npm dependency.

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

# Run tests
npm run test        # watch mode
npm run test:run    # single run

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
| GET    | `/reference`    | Scalar interactive API reference (browser UI) |
| GET    | `/openapi.json` | OpenAPI 3.0 specification (JSON)             |
| POST   | `/oauth/token`  | Client credentials → access token (see below) |
| POST   | `/error`        | Submit an error report                        |
| GET    | `/queue`        | Queue stats + list jobs (`?limit=50&status=pending`) |
| POST   | `/queue/trigger`| Manually trigger worker to process next job   |
| GET    | `/workspace`    | List workspace clone dirs (name, ageSeconds)  |
| POST   | `/workspace/cleanup` | Run cleanup (`?retentionDays=2&dryRun=true`)   |

### API documentation (Scalar)

After the server is running (`npm run dev` or `npm start`), open **`http://localhost:<PORT>/reference`** (default port `3000`). The page loads the machine-readable spec from **`/openapi.json`**, which you can also fetch directly for codegen or tooling.

When OAuth is enabled, these two routes remain public so you can read the docs without a token; use **`POST /oauth/token`** and Scalar’s **Authorize** (or your HTTP client) to call protected endpoints.

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

### OAuth 2.0 (optional)

If **both** `OAUTH_JWT_SECRET` and `OAUTH_CLIENTS` are set in the environment, the API requires a **Bearer access token** on every route **except** `GET /`, `GET /health`, `GET /openapi.json`, `GET /reference`, and `POST /oauth/token`. If either variable is missing or empty, OAuth is **disabled** and all routes behave as before (open).

**1. Obtain a token** — `POST /oauth/token` with JSON or `application/x-www-form-urlencoded`:

```json
{
  "grant_type": "client_credentials",
  "client_id": "your-client-id",
  "client_secret": "your-client-secret"
}
```

**Success (200):** `{ "access_token": "<jwt>", "token_type": "Bearer", "expires_in": 3600 }`

**Errors:** `400` / `401` with `{ "error": "...", "error_description": "..." }` (RFC 6749-style).

**2. Call the API** — `Authorization: Bearer <access_token>`

If OAuth is **not** configured (both env vars unset), `POST /oauth/token` returns `503` with `error: temporarily_unavailable`.

## Environment Variables

See [.env.example](.env.example) for all options. Key variables:

- `PORT` — Server port (default `3000`)
- `NODE_ENV` — `development` or `production`
- `LOG_LEVEL` — `debug`, `info`, `warn`, `error` (default `info`)

For Docker/pipeline: `CURSOR_API_KEY`, `GIT_TOKEN`, `GIT_URL` (optional; custom Git host), and `GIT_AUTHOR_NAME` / `GIT_AUTHOR_EMAIL` / `GIT_COMMITTER_NAME` / `GIT_COMMITTER_EMAIL`.

Workspace cleanup: `WORKSPACE_RETENTION_DAYS` (default `2`), `WORKSPACE_CLEANUP_INTERVAL_MS` (default `21600000` = 6 hours). Auto-cleanup runs 1 minute after startup, then every 6 hours.

OAuth (optional): `OAUTH_JWT_SECRET` (≥ 32 characters), `OAUTH_CLIENTS` (JSON array of `{ "client_id", "client_secret" }`), optional `OAUTH_ACCESS_TOKEN_TTL_SECONDS` (default `3600`). **Do not** set only one of `OAUTH_JWT_SECRET` / `OAUTH_CLIENTS` — the process will fail to start with a clear error.

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
├── index.ts              # Express app, routes, worker loop, /queue, /workspace endpoints
├── openapi.json          # OpenAPI spec served at GET /openapi.json (Scalar at GET /reference)
├── scalarReference.ts    # HTML shell for Scalar UI (CDN @scalar/api-reference)
├── auth/oauth.ts         # OAuth client credentials: JWT issue/verify, client map from env
├── middleware/requireBearerAuth.ts
├── queue/db.ts           # SQLite queue (enqueue, claimNext, setStatus, listQueueJobs, getQueueStats)
├── schemas/errorReport.ts
├── types/express-augment.ts  # merges oauthClientId onto Express Request (imported by middleware)
└── utils/
    ├── errorHandler.ts   # Pipeline (clone, agent steps) & handleError
    ├── fingerprint.ts    # Deduplication fingerprint (message + stack + source + branch)
    ├── logger.ts
    └── workspaceCleanup.ts  # List/delete old workspace dirs (2-day retention, auto + endpoints)
```

## Contributing

We welcome contributions. Please use **fork → feature branch → pull request**:

1. **Fork** this repository to your account.
2. Create a **feature branch** from the default branch (do not commit directly on `main`).
3. **Push** to your fork and open a **Pull Request** into this repo.

Details, naming conventions, and verification steps are in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

This project is licensed under the [MIT License](LICENSE).
