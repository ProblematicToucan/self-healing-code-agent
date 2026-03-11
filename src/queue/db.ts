import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { ErrorReport } from '../schemas/errorReport';
import { errorReportFingerprint } from '../utils/fingerprint';
import { logger } from '../utils/logger';

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
        updated_at TEXT NOT NULL,
        fingerprint TEXT
      );
    `);
    // Migration: add fingerprint column if table existed without it
    const columns = db.prepare(`PRAGMA table_info(error_jobs)`).all() as { name: string }[];
    if (!columns.some((c) => c.name === 'fingerprint')) {
      db.exec(`ALTER TABLE error_jobs ADD COLUMN fingerprint TEXT`);
    }
    db.exec(`CREATE INDEX IF NOT EXISTS idx_error_jobs_fingerprint_status ON error_jobs (fingerprint, status)`);
  }
  return db;
}

function now(): string {
  return new Date().toISOString();
}

/**
 * Insert a job with status `pending` unless the same issue is already pending or processing.
 * Same issue = same fingerprint (message + stack + source + branch). Returns the job id (new or existing).
 */
export function enqueue(report: ErrorReport): number {
  const database = getDb();
  const fingerprint = errorReportFingerprint(report);
  const existing = database
    .prepare(
      `SELECT id FROM error_jobs WHERE fingerprint = ? AND status IN ('pending', 'processing') LIMIT 1`
    )
    .get(fingerprint) as { id: number } | undefined;
  if (existing) return existing.id;
  const t = now();
  const stmt = database.prepare(
    `INSERT INTO error_jobs (payload, status, created_at, updated_at, fingerprint) VALUES (?, 'pending', ?, ?, ?)`
  );
  const result = stmt.run(JSON.stringify(report), t, t, fingerprint);
  return result.lastInsertRowid as number;
}

/**
 * Reclaim ALL rows in `processing` on startup (service just started = any processing was abandoned).
 * Call once when the worker starts.
 */
export function reclaimAbandonedOnStartup(): void {
  const database = getDb();
  const result = database
    .prepare(
      `UPDATE error_jobs SET status = 'pending', started_at = NULL, updated_at = ? WHERE status = 'processing'`
    )
    .run(now());
  if (result.changes > 0) {
    logger.info('reclaimed abandoned jobs on startup', { count: result.changes });
  }
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

export type QueueStats = {
  pending: number;
  processing: number;
  done: number;
  failed: number;
  total: number;
};

export type QueueJobSummary = {
  id: number;
  status: string;
  source: string | null;
  created_at: string;
  started_at: string | null;
  updated_at: string;
};

/**
 * Get counts per status. Queue is "finished" when pending === 0 && processing === 0.
 */
export function getQueueStats(): QueueStats {
  const database = getDb();
  const rows = database
    .prepare(
      `SELECT status, COUNT(*) as count FROM error_jobs GROUP BY status`
    )
    .all() as { status: string; count: number }[];
  const stats: QueueStats = { pending: 0, processing: 0, done: 0, failed: 0, total: 0 };
  for (const r of rows) {
    stats[r.status as keyof Omit<QueueStats, 'total'>] = r.count;
  }
  stats.total = stats.pending + stats.processing + stats.done + stats.failed;
  return stats;
}

/**
 * List jobs ordered by created_at desc. Optionally filter by status.
 */
export function listQueueJobs(options?: {
  limit?: number;
  status?: 'pending' | 'processing' | 'done' | 'failed';
}): QueueJobSummary[] {
  const database = getDb();
  const limit = Math.min(options?.limit ?? 50, 200);
  const statusFilter = options?.status;
  let sql = `SELECT id, payload, status, created_at, started_at, updated_at FROM error_jobs`;
  const params: (number | string)[] = [];
  if (statusFilter) {
    sql += ` WHERE status = ?`;
    params.push(statusFilter);
  }
  sql += ` ORDER BY created_at DESC LIMIT ?`;
  params.push(limit);
  const rows = database.prepare(sql).all(...params) as {
    id: number;
    payload: string;
    status: string;
    created_at: string;
    started_at: string | null;
    updated_at: string;
  }[];
  return rows.map((r) => {
    let source: string | null = null;
    try {
      const payload = JSON.parse(r.payload) as { source?: string };
      source = payload.source ?? null;
    } catch {
      // ignore
    }
    return {
      id: r.id,
      status: r.status,
      source,
      created_at: r.created_at,
      started_at: r.started_at,
      updated_at: r.updated_at,
    };
  });
}
