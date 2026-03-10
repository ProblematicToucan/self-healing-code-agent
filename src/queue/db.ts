import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { ErrorReport } from '../schemas/errorReport';

const DB_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DB_DIR, 'queue.db');
const STALE_MS = 10 * 60 * 1000; // 10 minutes

let db: Database.Database;

function getDb(): Database.Database {
  if (!db) {
    mkdirSync(DB_DIR, { recursive: true });
    db = new Database(DB_PATH);
    db.exec(`
      CREATE TABLE IF NOT EXISTS error_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payload TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'done', 'failed')),
        created_at TEXT NOT NULL,
        started_at TEXT,
        updated_at TEXT NOT NULL
      );
    `);
  }
  return db;
}

function now(): string {
  return new Date().toISOString();
}

/**
 * Insert a job with status `pending`. Returns the job id.
 */
export function enqueue(report: ErrorReport): number {
  const database = getDb();
  const t = now();
  const stmt = database.prepare(
    `INSERT INTO error_jobs (payload, status, created_at, updated_at) VALUES (?, 'pending', ?, ?)`
  );
  const result = stmt.run(JSON.stringify(report), t, t);
  return result.lastInsertRowid as number;
}

/**
 * Reclaim rows stuck in `processing` longer than STALE_MS by setting them back to `pending`.
 */
function reclaimStale(): void {
  const database = getDb();
  const cutoff = new Date(Date.now() - STALE_MS).toISOString();
  database
    .prepare(
      `UPDATE error_jobs SET status = 'pending', started_at = NULL, updated_at = ? WHERE status = 'processing' AND started_at < ?`
    )
    .run(now(), cutoff);
}

/**
 * Claim the next pending job (or one reclaimed from stale processing).
 * In one transaction: reclaim stale, then take one pending and set to `processing`.
 * Returns { id, report } or null if no job available.
 */
export function claimNext(): { id: number; report: ErrorReport } | null {
  const database = getDb();
  const t = now();
  return database.transaction(() => {
    reclaimStale();
    const row = database
      .prepare(
        `SELECT id, payload FROM error_jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1`
      )
      .get() as { id: number; payload: string } | undefined;
    if (!row) return null;
    database
      .prepare(
        `UPDATE error_jobs SET status = 'processing', started_at = ?, updated_at = ? WHERE id = ?`
      )
      .run(t, t, row.id);
    const report = JSON.parse(row.payload) as ErrorReport;
    return { id: row.id, report };
  })();
}

/**
 * Set job status to `done` or `failed` and update `updated_at`.
 */
export function setStatus(id: number, status: 'done' | 'failed'): void {
  const database = getDb();
  database.prepare(`UPDATE error_jobs SET status = ?, updated_at = ? WHERE id = ?`).run(status, now(), id);
}
