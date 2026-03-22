import { afterEach, describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { app, stopWorker } from './index.js';
import { closeDb, enqueue } from './queue/db.js';
import type { ErrorReport } from './schemas/errorReport.js';

vi.mock('./utils/errorHandler', () => ({
  runPipeline: vi.fn().mockResolvedValue(undefined),
  handleError: vi.fn(),
}));

/** Valid Bearer token for `test-client` / `test-secret` (see `src/test/setup.ts`). */
async function obtainAccessToken(): Promise<string> {
  const res = await request(app)
    .post('/oauth/token')
    .send({
      grant_type: 'client_credentials',
      client_id: 'test-client',
      client_secret: 'test-secret',
    });
  expect(res.status).toBe(200);
  expect(res.body.token_type).toBe('Bearer');
  expect(typeof res.body.access_token).toBe('string');
  return res.body.access_token as string;
}

function report(overrides: Partial<ErrorReport> = {}): ErrorReport {
  return {
    message: 'TypeError: x of undefined',
    branch: 'main',
    source: 'https://github.com/user/repo.git',
    ...overrides,
  };
}

afterEach(() => {
  stopWorker();
  closeDb();
});

describe('GET /openapi.json', () => {
  it('returns OpenAPI document', async () => {
    const res = await request(app).get('/openapi.json');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body.openapi).toBe('3.0.3');
    expect(res.body.info?.title).toBe('Self-healing API');
  });
});

describe('GET /reference', () => {
  it('returns Scalar HTML shell', async () => {
    const res = await request(app).get('/reference');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.text).toContain('Scalar.createApiReference');
    expect(res.text).toContain('/openapi.json');
    expect(res.text).toContain('rel="icon"');
    expect(res.text).toContain('/favicon.ico');
  });
});

describe('GET /favicon.ico', () => {
  it('returns favicon bytes', async () => {
    const res = await request(app).get('/favicon.ico');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/x-icon/);
    const len = Buffer.isBuffer(res.body) ? res.body.length : Buffer.byteLength(String(res.body));
    expect(len).toBeGreaterThan(0);
  });
});

describe('GET /', () => {
  it('returns service metadata JSON', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      name: 'Self-Healing Code',
      version: '1.0.0',
      description: 'Self-healing API for automated error repair pipelines',
      documentation: '/reference',
      openapi: '/openapi.json',
    });
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
    const token = await obtainAccessToken();
    const res = await request(app)
      .post('/error')
      .set('Authorization', `Bearer ${token}`)
      .send({
        message: 'TypeError: x of undefined',
        branch: 'main',
        source: 'https://github.com/user/repo.git',
      });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: true, jobId: expect.any(Number) });
  });

  it('rejects missing message with 400', async () => {
    const token = await obtainAccessToken();
    const res = await request(app)
      .post('/error')
      .set('Authorization', `Bearer ${token}`)
      .send({ branch: 'main', source: 'https://github.com/user/repo.git' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('rejects missing branch with 400', async () => {
    const token = await obtainAccessToken();
    const res = await request(app)
      .post('/error')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'Error', source: 'https://github.com/user/repo.git' });
    expect(res.status).toBe(400);
  });

  it('rejects empty source with 400', async () => {
    const token = await obtainAccessToken();
    const res = await request(app)
      .post('/error')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'Error', branch: 'main', source: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('source is required');
  });

  it('rejects whitespace-only source with 400', async () => {
    const token = await obtainAccessToken();
    const res = await request(app)
      .post('/error')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'Error', branch: 'main', source: '   ' });
    expect(res.status).toBe(400);
  });
});

describe('GET /queue', () => {
  it('returns stats and jobs', async () => {
    const token = await obtainAccessToken();
    const res = await request(app).get('/queue').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      stats: { pending: 0, processing: 0, done: 0, failed: 0, total: 0 },
      finished: true,
      jobs: [],
    });
  });

  it('returns enqueued job in list', async () => {
    enqueue(report());
    const token = await obtainAccessToken();
    const res = await request(app).get('/queue').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.stats.pending).toBe(1);
    expect(res.body.jobs).toHaveLength(1);
    expect(res.body.jobs[0].source).toBe('https://github.com/user/repo.git');
  });

  it('accepts limit and status query params', async () => {
    const token = await obtainAccessToken();
    const res = await request(app)
      .get('/queue?limit=5&status=pending')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.jobs).toBeDefined();
  });
});

describe('POST /queue/trigger', () => {
  it('returns triggered false when queue is empty', async () => {
    const token = await obtainAccessToken();
    const res = await request(app)
      .post('/queue/trigger')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.triggered).toBe(false);
    expect(res.body.message).toContain('empty');
  });

  it('returns triggered true when queue has pending job', async () => {
    enqueue(report());
    const token = await obtainAccessToken();
    const res = await request(app)
      .post('/queue/trigger')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.triggered).toBe(true);
  });
});

describe('GET /workspace', () => {
  it('returns 200 and entries array', async () => {
    const token = await obtainAccessToken();
    const res = await request(app).get('/workspace').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('entries');
    expect(Array.isArray(res.body.entries)).toBe(true);
  });
});

describe('POST /workspace/cleanup', () => {
  it('returns 200 with deleted and dryRun when dryRun=true', async () => {
    const token = await obtainAccessToken();
    const res = await request(app)
      .post('/workspace/cleanup?dryRun=true')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ dryRun: true });
    expect(Array.isArray(res.body.deleted)).toBe(true);
  });

  it('returns 200 with deleted array when no query params', async () => {
    const token = await obtainAccessToken();
    const res = await request(app)
      .post('/workspace/cleanup')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('deleted');
    expect(res.body.dryRun).toBe(false);
  });

  it('accepts retentionDays query param', async () => {
    const token = await obtainAccessToken();
    const res = await request(app)
      .post('/workspace/cleanup?retentionDays=3&dryRun=true')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.dryRun).toBe(true);
  });
});

describe('OAuth 2.0 client credentials', () => {
  it('returns 401 for protected route without Bearer token', async () => {
    const res = await request(app).get('/queue');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_request');
  });

  it('returns 401 for invalid Bearer token', async () => {
    const res = await request(app)
      .get('/queue')
      .set('Authorization', 'Bearer not-a-jwt');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_token');
  });

  it('POST /oauth/token rejects wrong client_secret', async () => {
    const res = await request(app).post('/oauth/token').send({
      grant_type: 'client_credentials',
      client_id: 'test-client',
      client_secret: 'wrong',
    });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_client');
  });

  it('POST /oauth/token rejects unsupported grant_type', async () => {
    const res = await request(app).post('/oauth/token').send({
      grant_type: 'password',
      client_id: 'test-client',
      client_secret: 'test-secret',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unsupported_grant_type');
  });

  it('POST /oauth/token accepts application/x-www-form-urlencoded', async () => {
    const res = await request(app)
      .post('/oauth/token')
      .type('form')
      .send(
        'grant_type=client_credentials&client_id=test-client&client_secret=test-secret'
      );
    expect(res.status).toBe(200);
    expect(res.body.token_type).toBe('Bearer');
    expect(typeof res.body.access_token).toBe('string');
  });
});
