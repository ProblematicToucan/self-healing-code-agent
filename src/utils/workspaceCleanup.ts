import { readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { logger } from './logger';

const WORKSPACE_DIR = 'workspace';

export interface WorkspaceEntry {
  name: string;
  ageSeconds: number;
}

/**
 * Resolve the workspace root directory (project root + workspace).
 */
export function getWorkspaceRoot(): string {
  return path.join(process.cwd(), WORKSPACE_DIR);
}

/**
 * List direct child directories of workspace with name and age (seconds since mtime).
 * Throws if the workspace root cannot be read (IO/permission).
 */
export function listWorkspaceEntries(): WorkspaceEntry[] {
  const root = getWorkspaceRoot();
  try {
    const names = readdirSync(root);
    const entries: WorkspaceEntry[] = [];
    const now = Date.now();
    for (const name of names) {
      if (name === '.' || name === '..') continue;
      const fullPath = path.join(root, name);
      try {
        const stat = statSync(fullPath);
        if (!stat.isDirectory()) continue;
        const ageSeconds = Math.max(0, Math.floor((now - stat.mtimeMs) / 1000));
        entries.push({ name, ageSeconds });
      } catch {
        // skip unreadable entries
      }
    }
    return entries;
  } catch (err) {
    logger.error('workspace list failed: readdir', {
      root,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Delete workspace directories older than retentionDays (by mtime), or return would-be-deleted list if dryRun.
 * Returns list of deleted (or would-be-deleted) directory names.
 * Throws if the workspace root cannot be read (IO/permission). Per-entry errors are logged and skipped.
 */
export function runWorkspaceCleanup(retentionDays: number, dryRun: boolean): string[] {
  const root = getWorkspaceRoot();
  const cutoff = Date.now() - retentionDays * MS_PER_DAY;
  const deleted: string[] = [];
  try {
    const names = readdirSync(root);
    for (const name of names) {
      if (name === '.' || name === '..') continue;
      const fullPath = path.join(root, name);
      try {
        const stat = statSync(fullPath);
        if (!stat.isDirectory()) continue;
        if (stat.mtimeMs >= cutoff) continue;
        if (dryRun) {
          deleted.push(name);
        } else {
          try {
            rmSync(fullPath, { recursive: true });
            deleted.push(name);
          } catch (err) {
            console.error('[workspace-cleanup] failed to delete', fullPath, err);
          }
        }
      } catch (err) {
        console.error('[workspace-cleanup] stat failed for', fullPath, err);
      }
    }
  } catch (err) {
    logger.error('workspace cleanup failed: readdir', {
      root,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
  return deleted;
}
