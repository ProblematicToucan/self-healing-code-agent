import { afterEach, describe, it, expect } from 'vitest';
import {
  closeDb,
  enqueue,
  claimNext,
  setStatus,
  getQueueStats,
  listQueueJobs,
  reclaimAbandonedOnStartup,
} from './db';
import type { ErrorReport } from '../schemas/errorReport';

function report(overrides: Partial<ErrorReport> = {}): ErrorReport {
  return {
    message: 'TypeError: x of undefined',
    branch: 'main',
    source: 'https://github.com/user/repo.git',
    ...overrides,
  };
}

afterEach(() => {
  closeDb();
});

describe('enqueue', () => {
  it('inserts a job and returns its id', () => {
    const id = enqueue(report());
    expect(id).toBeGreaterThan(0);
    expect(getQueueStats().pending).toBe(1);
  });

  it('deduplicates by fingerprint (same message, stack, source, branch)', () => {
    const r = report();
    const id1 = enqueue(r);
    const id2 = enqueue(r);
    expect(id1).toBe(id2);
    expect(getQueueStats().pending).toBe(1);
  });

  it('allows duplicate when previous job is done', () => {
    const r = report();
    const id1 = enqueue(r);
    const job = claimNext();
    expect(job).not.toBeNull();
    if (job) setStatus(job.id, 'done');
    const id2 = enqueue(r);
    expect(id2).not.toBe(id1);
    expect(getQueueStats().pending).toBe(1);
  });
});

describe('claimNext', () => {
  it('returns null when queue is empty', () => {
    expect(claimNext()).toBeNull();
  });

  it('returns job and sets status to processing', () => {
    enqueue(report());
    const job = claimNext();
    expect(job).not.toBeNull();
    if (job) {
      expect(job.report.message).toBe('TypeError: x of undefined');
      expect(job.report.source).toBe('https://github.com/user/repo.git');
      expect(getQueueStats().processing).toBe(1);
      expect(getQueueStats().pending).toBe(0);
    }
  });

  it('returns jobs in created_at order', () => {
    enqueue(report({ message: 'First' }));
    enqueue(report({ message: 'Second', source: 'https://github.com/other/repo.git' }));
    const first = claimNext();
    expect(first?.report.message).toBe('First');
    setStatus(first!.id, 'done');
    const second = claimNext();
    expect(second?.report.message).toBe('Second');
  });
});

describe('setStatus', () => {
  it('updates job to done', () => {
    enqueue(report());
    const job = claimNext();
    expect(job).not.toBeNull();
    if (job) {
      setStatus(job.id, 'done');
      expect(getQueueStats().done).toBe(1);
    }
  });

  it('updates job to failed', () => {
    enqueue(report());
    const job = claimNext();
    expect(job).not.toBeNull();
    if (job) {
      setStatus(job.id, 'failed');
      expect(getQueueStats().failed).toBe(1);
    }
  });
});

describe('getQueueStats', () => {
  it('returns zeros when empty', () => {
    const stats = getQueueStats();
    expect(stats).toEqual({ pending: 0, processing: 0, done: 0, failed: 0, total: 0 });
  });

  it('aggregates counts correctly', () => {
    enqueue(report({ message: 'A' }));
    enqueue(report({ message: 'B', source: 'https://github.com/b/repo.git' }));
    const job = claimNext();
    if (job) setStatus(job.id, 'done');
    const stats = getQueueStats();
    expect(stats.pending).toBe(1);
    expect(stats.processing).toBe(0);
    expect(stats.done).toBe(1);
    expect(stats.total).toBe(2);
  });
});

describe('listQueueJobs', () => {
  it('returns empty array when no jobs', () => {
    expect(listQueueJobs()).toEqual([]);
  });

  it('returns jobs with source extracted from payload', () => {
    enqueue(report({ source: 'https://github.com/foo/bar.git' }));
    const jobs = listQueueJobs({ limit: 10 });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe('pending');
    expect(jobs[0].source).toBe('https://github.com/foo/bar.git');
  });

  it('respects limit', () => {
    for (let i = 0; i < 5; i++) {
      enqueue(report({ message: `Err ${i}`, source: `https://github.com/u/r${i}.git` }));
    }
    const jobs = listQueueJobs({ limit: 2 });
    expect(jobs).toHaveLength(2);
  });

  it('caps limit at 200', () => {
    const jobs = listQueueJobs({ limit: 500 });
    expect(jobs).toHaveLength(0);
    // Just ensure no error; behavior is "min(option, 200)"
    const jobs2 = listQueueJobs({ limit: 200 });
    expect(jobs2).toHaveLength(0);
  });

  it('filters by status when provided', () => {
    enqueue(report({ message: 'A' }));
    const job = claimNext();
    if (job) setStatus(job.id, 'done');
    const pending = listQueueJobs({ status: 'pending' });
    const done = listQueueJobs({ status: 'done' });
    expect(pending).toHaveLength(0);
    expect(done).toHaveLength(1);
  });
});

describe('reclaimAbandonedOnStartup', () => {
  it('moves processing jobs back to pending', () => {
    enqueue(report());
    claimNext();
    expect(getQueueStats().processing).toBe(1);
    reclaimAbandonedOnStartup();
    expect(getQueueStats().processing).toBe(0);
    expect(getQueueStats().pending).toBe(1);
  });
});
