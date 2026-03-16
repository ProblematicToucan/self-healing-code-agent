# Workspace Cleanup — Implementation Plan

**Design:** 2-day retention; `GET /workspace` (list), `POST /workspace/cleanup` (optional `retentionDays`, `dryRun`); auto-cleanup every 6h after 1 min delay. Env: `WORKSPACE_RETENTION_DAYS`, `WORKSPACE_CLEANUP_INTERVAL_MS`.

---

## Task 1: `listWorkspaceEntries` + `getWorkspaceRoot` + unit tests

1. Add `src/utils/workspaceCleanup.ts`.
2. Implement `getWorkspaceRoot()`: return `path.join(process.cwd(), 'workspace')` (reuse same constant as errorHandler or define locally).
3. Implement `listWorkspaceEntries()`: readdirSync workspace root; for each entry statSync; if directory, include `{ name, ageSeconds, sizeBytes? }` (age from mtime; size optional via du or skip for now). If workspace dir missing, return `[]`. Skip non-directories and `.`/`..`.
4. Unit tests: mock fs or use tmpDir; test empty dir returns `[]`, missing workspace returns `[]`, one dir returns one entry with correct ageSeconds.

---

## Task 2: `runWorkspaceCleanup(retentionDays, dryRun)` + unit tests

1. In `workspaceCleanup.ts`, implement `runWorkspaceCleanup(retentionDays: number, dryRun: boolean): string[]`. List dirs in workspace; for each dir, if mtime < (now - retentionDays * 24 * 60 * 60 * 1000), either delete with `rmSync(..., { recursive: true })` or add to list if dryRun. Return list of deleted (or would-be-deleted) dir names.
2. If workspace missing, return `[]`. Use sync APIs. Log errors but don’t throw; continue with other dirs.
3. Unit tests: create temp dirs with old mtime, run cleanup with retentionDays, assert correct dirs deleted/returned; test dryRun returns same list without deleting.

---

## Task 3: `GET /workspace` and `POST /workspace/cleanup` + API tests

1. In `src/index.ts`: add `GET /workspace` → call `listWorkspaceEntries()`, respond `{ entries: [...] }`.
2. Add `POST /workspace/cleanup` with query params `retentionDays` (optional), `dryRun` (optional). Use default retention from env `WORKSPACE_RETENTION_DAYS` or 2. Call `runWorkspaceCleanup(retentionDays, dryRun)`, respond `{ deleted: string[], dryRun: boolean }`.
3. API tests in `src/index.test.ts`: GET /workspace returns 200 and array; POST /workspace/cleanup?dryRun=true returns 200 and list; with real temp dirs, POST cleanup removes old dirs and leaves recent ones.

---

## Task 4: Auto-cleanup on startup + every 6 hours

1. On server start (where worker is started): after 1 min delay, run `runWorkspaceCleanup(retentionDays, false)` once. Then schedule same call every 6 hours (or `WORKSPACE_CLEANUP_INTERVAL_MS`). Use same default retention (env or 2).
2. Log each run (e.g. "workspace cleanup ran, deleted N dirs"). Do not run in test env.

---

## Task 5: `.env.example` and README

1. Add to `.env.example`: `WORKSPACE_RETENTION_DAYS=2`, `WORKSPACE_CLEANUP_INTERVAL_MS=21600000` (6h) with short comment.
2. README: document workspace cleanup (endpoints + auto 2-day retention, env vars).

---

## Task 6 (optional): `sizeBytes` in list entries

Can be skipped; add later if needed (e.g. du of each dir).
