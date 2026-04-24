import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { runPipeline } from './errorHandler.js';
import type { ErrorReport } from '../schemas/errorReport.js';

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(() => ({ status: 0 })),
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual('node:fs');
  return {
    ...actual,
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(() => ''),
    appendFileSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
});

describe('errorHandler security', () => {
  const mockReport: ErrorReport = {
    message: 'test error',
    branch: 'main',
    source: 'https://github.com/user/repo.git',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks source starting with hyphen (option injection)', async () => {
    const report = { ...mockReport, source: '--upload-pack=touch /tmp/pwn' };
    await expect(runPipeline(report)).rejects.toThrow('git clone failed');
    expect(spawnSync).not.toHaveBeenCalledWith('git', expect.arrayContaining(['clone', expect.stringContaining('--upload-pack')]), expect.anything());
  });

  it('blocks local file source (file:// protocol)', async () => {
    const report = { ...mockReport, source: 'file:///etc/passwd' };
    await expect(runPipeline(report)).rejects.toThrow('git clone failed');
  });

  it('blocks local path source', async () => {
    const report = { ...mockReport, source: '/etc/passwd' };
    await expect(runPipeline(report)).rejects.toThrow('git clone failed');
  });

  it('allows valid https source', async () => {
    const report = { ...mockReport, source: 'https://github.com/user/repo.git' };
    await runPipeline(report);
    expect(spawnSync).toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['clone', '-b', 'main', '--', 'https://github.com/user/repo.git', expect.any(String)]),
      expect.anything()
    );
  });

  it('allows valid ssh source', async () => {
    const report = { ...mockReport, source: 'ssh://git@github.com/user/repo.git' };
    await runPipeline(report);
    expect(spawnSync).toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['clone', '-b', 'main', '--', 'ssh://git@github.com/user/repo.git', expect.any(String)]),
      expect.anything()
    );
  });

  it('allows valid SCP-like source', async () => {
    const report = { ...mockReport, source: 'git@github.com:user/repo.git' };
    await runPipeline(report);
    expect(spawnSync).toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['clone', '-b', 'main', '--', 'git@github.com:user/repo.git', expect.any(String)]),
      expect.anything()
    );
  });

  it('blocks branch starting with hyphen (option injection)', async () => {
    const report = { ...mockReport, branch: '--upload-pack=touch /tmp/pwned' };
    await expect(runPipeline(report)).rejects.toThrow('git clone failed');
    expect(spawnSync).not.toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['clone', '-b', expect.stringMatching(/^-/)]),
      expect.anything()
    );
  });
});
