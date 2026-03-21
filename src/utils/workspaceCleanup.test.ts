import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { getWorkspaceRoot, listWorkspaceEntries, runWorkspaceCleanup } from './workspaceCleanup.js';

describe('workspaceCleanup', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = path.join(tmpdir(), `workspace-cleanup-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('getWorkspaceRoot', () => {
    it('returns path joining cwd and workspace dir', () => {
      expect(getWorkspaceRoot()).toBe(path.join(tmpDir, 'workspace'));
    });
  });

  describe('listWorkspaceEntries', () => {
    it('throws when workspace dir does not exist', () => {
      expect(() => listWorkspaceEntries()).toThrow();
    });

    it('returns [] when workspace dir is empty', () => {
      mkdirSync(path.join(tmpDir, 'workspace'), { recursive: true });
      expect(listWorkspaceEntries()).toEqual([]);
    });

    it('returns one entry for one subdirectory with correct ageSeconds', () => {
      const workspaceRoot = path.join(tmpDir, 'workspace');
      mkdirSync(workspaceRoot, { recursive: true });
      const subDir = path.join(workspaceRoot, 'my-repo-123');
      mkdirSync(subDir, { recursive: true });
      const ageSeconds = 120;
      writeFileSync(path.join(subDir, 'x'), '');
      // listWorkspaceEntries uses directory mtime; set deterministic mtime for age assertion
      const mtimeSec = (Date.now() - ageSeconds * 1000) / 1000;
      utimesSync(subDir, mtimeSec, mtimeSec);
      const entries = listWorkspaceEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('my-repo-123');
      expect(entries[0].ageSeconds).toBeGreaterThanOrEqual(ageSeconds);
      expect(entries[0].ageSeconds).toBeLessThan(ageSeconds + 2);
    });

    it('ignores files and only lists directories', () => {
      const workspaceRoot = path.join(tmpDir, 'workspace');
      mkdirSync(workspaceRoot, { recursive: true });
      writeFileSync(path.join(workspaceRoot, 'file.txt'), '');
      mkdirSync(path.join(workspaceRoot, 'repo-1'), { recursive: true });
      const entries = listWorkspaceEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('repo-1');
    });
  });

  describe('runWorkspaceCleanup', () => {
    it('throws when workspace dir does not exist', () => {
      expect(() => runWorkspaceCleanup(2, false)).toThrow();
      expect(() => runWorkspaceCleanup(2, true)).toThrow();
    });

    it('deletes dirs older than retentionDays and returns their names', () => {
      const workspaceRoot = path.join(tmpDir, 'workspace');
      mkdirSync(workspaceRoot, { recursive: true });
      const oldDir = path.join(workspaceRoot, 'old-repo-1');
      mkdirSync(oldDir, { recursive: true });
      writeFileSync(path.join(oldDir, 'x'), '');
      const threeDaysAgo = (Date.now() - 3 * 24 * 60 * 60 * 1000) / 1000;
      utimesSync(oldDir, threeDaysAgo, threeDaysAgo);

      const deleted = runWorkspaceCleanup(2, false);
      expect(deleted).toEqual(['old-repo-1']);
      const entries = listWorkspaceEntries();
      expect(entries).toHaveLength(0);
    });

    it('leaves dirs newer than retentionDays', () => {
      const workspaceRoot = path.join(tmpDir, 'workspace');
      mkdirSync(workspaceRoot, { recursive: true });
      mkdirSync(path.join(workspaceRoot, 'recent-repo'), { recursive: true });

      const deleted = runWorkspaceCleanup(2, false);
      expect(deleted).toEqual([]);
      const entries = listWorkspaceEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('recent-repo');
    });

    it('dryRun returns same list without deleting', () => {
      const workspaceRoot = path.join(tmpDir, 'workspace');
      mkdirSync(workspaceRoot, { recursive: true });
      const oldDir = path.join(workspaceRoot, 'old-repo-2');
      mkdirSync(oldDir, { recursive: true });
      writeFileSync(path.join(oldDir, 'y'), '');
      const threeDaysAgo = (Date.now() - 3 * 24 * 60 * 60 * 1000) / 1000;
      utimesSync(oldDir, threeDaysAgo, threeDaysAgo);

      const wouldDelete = runWorkspaceCleanup(2, true);
      expect(wouldDelete).toEqual(['old-repo-2']);
      const entries = listWorkspaceEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('old-repo-2');
    });
  });
});
