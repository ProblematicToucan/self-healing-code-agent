# Workspace Cleanup — Design

**Date:** 2025-03-16  
**Status:** Approved

## Goal

Add workspace cleanup with 2-day retention: both HTTP endpoints (list + trigger cleanup) and an automatic periodic cleanup, so clone dirs under `workspace/` do not grow unbounded.

## Scope and Retention

- **Target:** Only direct children of `workspace/` (i.e. `workspace/<slug>-<timestamp>/`). No touching `data/` or queue DB.
- **Age:** “Older than N days” = directory’s **mtime** (last modified) &lt; (now − N days). Using mtime avoids deleting dirs that were recently written to.
- **Default retention:** 2 days. Overridable via env (`WORKSPACE_RETENTION_DAYS=2`) and, for the cleanup endpoint only, via query param (e.g. `?retentionDays=3`).
- **Auto-cleanup interval:** Run every 6 hours (or env `WORKSPACE_CLEANUP_INTERVAL_MS`). First run shortly after startup (e.g. 1 minute delay).

## Endpoints

### GET /workspace

- Lists workspace directories: name, age (e.g. seconds or ISO), optional size.
- If `workspace/` is missing, return `[]`.
- Response: `{ entries: { name, ageSeconds, sizeBytes? }[] }`.

### POST /workspace/cleanup

- Query params: `retentionDays` (optional, default from env or 2), `dryRun` (optional, default false).
- Deletes dirs in `workspace/` with mtime older than `retentionDays` (or only lists them if `dryRun=true`).
- Response: `{ deleted: string[], dryRun: boolean }` (names of deleted/would-be-deleted dirs).
- Idempotent; no body required.

## Auto-Cleanup

- On server start: after a short delay (e.g. 1 min), run cleanup once, then schedule the same logic every 6 hours (or `WORKSPACE_CLEANUP_INTERVAL_MS`).
- Reuse the same “list dirs by mtime, delete if older than retention” function as `POST /workspace/cleanup`.
- Log each run and log errors per-dir but continue; do not crash the process.

## Implementation Notes

- **Listing/deletion:** `readdirSync` on `workspace/`, for each entry `statSync` and check `stat.mtime`. If directory and `mtime < (now - retentionDays)`, `rmSync(..., { recursive: true })`. Skip non-directories.
- **Config:** `WORKSPACE_RETENTION_DAYS` (default 2), `WORKSPACE_CLEANUP_INTERVAL_MS` (default 6 * 60 * 60 * 1000).
- **Safety:** No job→cloneDir tracking in DB; 2-day window is large enough that active jobs (minutes) won’t be deleted.

## Testing

- Unit tests: function that, given dir names + mtimes (or mocked fs), returns “which would be deleted” for a given retention.
- API tests: `GET /workspace` returns 200 and array; `POST /workspace/cleanup?dryRun=true` returns 200 and list; with temp dirs, `POST /workspace/cleanup` removes old dirs and leaves recent ones.
