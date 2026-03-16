import { afterEach, describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { app } from './index';
import { closeDb, enqueue } from './queue/db';
import type { ErrorReport } from './schemas/errorReport';

vi.mock('./utils/errorHandler', () => ({
  runPipeline: vi.fn().mockResolvedValue(undefined),
  handleError: vi.fn(),
}));

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

describe('GET /', () => {
  it('returns hello JSON', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'Hello from Express + TypeScript' });
  });
});

describe('GET /health', () => {
  it('returns status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('POST /error', () => {
  it('accepts valid report and returns 202 with jobId', async () => {
    const res = await request(app)
      .post('/error')
      .send({
        message: 'TypeError: x of undefined',
        branch: 'main',
        source: 'https://github.com/user/repo.git',
      });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: true, jobId: expect.any(Number) });
  });

  it('rejects missing message with 400', async () => {
    const res = await request(app)
      .post('/error')
      .send({ branch: 'main', source: 'https://github.com/user/repo.git' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('rejects missing branch with 400', async () => {
    const res = await request(app)
      .post('/error')
      .send({ message: 'Error', source: 'https://github.com/user/repo.git' });
    expect(res.status).toBe(400);
  });

  it('rejects empty source with 400', async () => {
    const res = await request(app)
      .post('/error')
      .send({ message: 'Error', branch: 'main', source: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('source is required');
  });

  it('rejects whitespace-only source with 400', async () => {
    const res = await request(app)
      .post('/error')
      .send({ message: 'Error', branch: 'main', source: '   ' });
    expect(res.status).toBe(400);
  });
});

describe('GET /queue', () => {
  it('returns stats and jobs', async () => {
    const res = await request(app).get('/queue');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      stats: { pending: 0, processing: 0, done: 0, failed: 0, total: 0 },
      finished: true,
      jobs: [],
    });
  });

  it('returns enqueued job in list', async () => {
    enqueue(report());
    const res = await request(app).get('/queue');
    expect(res.status).toBe(200);
    expect(res.body.stats.pending).toBe(1);
    expect(res.body.jobs).toHaveLength(1);
    expect(res.body.jobs[0].source).toBe('https://github.com/user/repo.git');
  });

  it('accepts limit and status query params', async () => {
    const res = await request(app).get('/queue?limit=5&status=pending');
    expect(res.status).toBe(200);
    expect(res.body.jobs).toBeDefined();
  });
});

describe('POST /queue/trigger', () => {
  it('returns triggered false when queue is empty', async () => {
    const res = await request(app).post('/queue/trigger');
    expect(res.status).toBe(200);
    expect(res.body.triggered).toBe(false);
    expect(res.body.message).toContain('empty');
  });

  it('returns triggered true when queue has pending job', async () => {
    enqueue(report());
    const res = await request(app).post('/queue/trigger');
    expect(res.status).toBe(200);
    expect(res.body.triggered).toBe(true);
  });
});
