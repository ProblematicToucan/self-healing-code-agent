import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { logger } from './logger.js';

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
export async function listWorkspaceEntries(): Promise<WorkspaceEntry[]> {
  const root = getWorkspaceRoot();
  try {
    const now = Date.now();
    const dirEntries = await readdir(root, { withFileTypes: true });

    const entriesPromises = dirEntries
      .filter(d => d.isDirectory())
      .map(async (dirEntry) => {
        const name = dirEntry.name;
        const fullPath = path.join(root, name);
        try {
          const s = await stat(fullPath);
          return {
            name,
            ageSeconds: Math.max(0, Math.floor((now - s.mtimeMs) / 1000))
          };
        } catch {
          return null;
        }
      });

    const results = await Promise.all(entriesPromises);
    return results.filter((e): e is WorkspaceEntry => e !== null);
  } catch (err) {
    logger.error('workspace list failed: readdir', {
      root,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
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
export async function runWorkspaceCleanup(retentionDays: number, dryRun: boolean): Promise<string[]> {
  const root = getWorkspaceRoot();
  const cutoff = Date.now() - retentionDays * MS_PER_DAY;
  try {
    const dirEntries = await readdir(root, { withFileTypes: true });

    const cleanupPromises = dirEntries
      .filter(d => d.isDirectory())
      .map(async (dirEntry) => {
        const name = dirEntry.name;
        const fullPath = path.join(root, name);
        try {
          const s = await stat(fullPath);
          if (s.mtimeMs >= cutoff) return null;

          if (dryRun) {
            return name;
          } else {
            try {
              await rm(fullPath, { recursive: true });
              return name;
            } catch (err) {
              logger.error('[workspace-cleanup] failed to delete', {
                path: fullPath,
                error: err instanceof Error ? err.message : String(err),
                stack: err instanceof Error ? err.stack : undefined,
              });
              return null;
            }
          }
        } catch (err) {
          logger.error('[workspace-cleanup] stat failed', {
            path: fullPath,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
          });
          return null;
        }
      });

    const results = await Promise.all(cleanupPromises);
    return results.filter((n): n is string => n !== null);
  } catch (err) {
    logger.error('workspace cleanup failed: readdir', {
      root,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    throw err;
  }
}
