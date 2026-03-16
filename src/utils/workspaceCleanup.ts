import { readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

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
 * If workspace does not exist, returns [].
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
  } catch {
    return [];
  }
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Delete workspace directories older than retentionDays (by mtime), or return would-be-deleted list if dryRun.
 * Returns list of deleted (or would-be-deleted) directory names. If workspace missing, returns [].
 * Logs errors but does not throw; continues with other dirs.
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
  } catch {
    return [];
  }
  return deleted;
}
