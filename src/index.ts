import 'dotenv/config';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  assertOAuthConfigOrThrow,
  isOAuthEnabled,
  issueAccessToken,
  verifyClientCredentials,
} from './auth/oauth.js';
import {
  claimNext,
  enqueue,
  getQueueStats,
  listQueueJobs,
  reclaimAbandonedOnStartup,
  setStatus,
} from './queue/db.js';
import { requireBearerAuth } from './middleware/requireBearerAuth.js';
import { errorReportSchema } from './schemas/errorReport.js';
import { handleError, runPipeline } from './utils/errorHandler.js';
import { logger } from './utils/logger.js';
import { listWorkspaceEntries, runWorkspaceCleanup } from './utils/workspaceCleanup.js';
import openApiSpec from './openapi.json' with { type: 'json' };
import { scalarReferenceHtml } from './scalarReference.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FAVICON_ICO_PATH = join(__dirname, 'favico.ico');
let faviconIcoCache: Buffer | null | undefined;

function getFaviconIco(): Buffer | null {
  if (faviconIcoCache !== undefined) {
    return faviconIcoCache;
  }
  try {
    faviconIcoCache = readFileSync(FAVICON_ICO_PATH);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      faviconIcoCache = null;
      logger.warn('favicon not found', { path: FAVICON_ICO_PATH });
      return null;
    }
    throw err;
  }
  return faviconIcoCache;
}

assertOAuthConfigOrThrow();

const POLL_INTERVAL_MS = 1500;

const app = express();
const port = process.env.PORT ?? 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.get('/openapi.json', (_req: Request, res: Response) => {
  res.json(openApiSpec);
});

app.get('/reference', (_req: Request, res: Response) => {
  res
    .type('text/html')
    .send(
      scalarReferenceHtml({
        specUrl: '/openapi.json',
        pageTitle: 'Self-healing API',
      })
    );
});

app.get('/favicon.ico', (_req: Request, res: Response) => {
  const icon = getFaviconIco();
  if (!icon) {
    res.status(404).end();
    return;
  }
  res.type('image/x-icon').send(icon);
});

/** Log each request: method, path, status, duration, and client ip. */
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
  res.on('finish', () => {
    const durationMs = Date.now() - start;
    logger.info('request', {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs,
      ip,
        ...(req.route ? { route: req.route.path } : {}),
    });
  });
  next();
});

app.use(requireBearerAuth);

const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

app.get(
  '/',
  asyncHandler(async (_req: Request, res: Response) => {
    res.json({
      name: 'Self-Healing Code',
      version: '1.0.0',
      description: 'Self-healing API for automated error repair pipelines',
      documentation: '/reference',
      openapi: '/openapi.json',
    });
  })
);

app.get(
  '/health',
  asyncHandler(async (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  })
);

app.post(
  '/oauth/token',
  asyncHandler(async (req: Request, res: Response) => {
    if (!isOAuthEnabled()) {
      res.status(503).json({
        error: 'temporarily_unavailable',
        error_description:
          'OAuth client credentials are not configured on this server',
      });
      return;
    }
    const grantType = req.body?.grant_type;
    if (grantType !== 'client_credentials') {
      res.status(400).json({
        error: 'unsupported_grant_type',
        error_description: 'Only grant_type=client_credentials is supported',
      });
      return;
    }
    const clientId = req.body?.client_id;
    const clientSecret = req.body?.client_secret;
    if (
      typeof clientId !== 'string' ||
      typeof clientSecret !== 'string' ||
      !clientId ||
      !clientSecret
    ) {
      res.status(400).json({
        error: 'invalid_request',
        error_description: 'client_id and client_secret are required',
      });
      return;
    }
    if (!verifyClientCredentials(clientId, clientSecret)) {
      res.status(401).json({
        error: 'invalid_client',
        error_description: 'Client authentication failed',
      });
      return;
    }
    const token = await issueAccessToken(clientId);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.status(200).json(token);
  })
);

const DEFAULT_RETENTION_DAYS = 2;
const MIN_RETENTION_DAYS = 1;
const MAX_RETENTION_DAYS = 365;
const WORKSPACE_CLEANUP_FIRST_DELAY_MS = 60 * 1000; // 1 minute
const WORKSPACE_CLEANUP_INTERVAL_MS_DEFAULT = 6 * 60 * 60 * 1000; // 6 hours
const MIN_INTERVAL_MS = 60 * 1000; // 1 minute
const MAX_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week

function getValidatedWorkspaceCleanupConfig(): {
  retentionDays: number;
  intervalMs: number;
} {
  const rawRetention = process.env.WORKSPACE_RETENTION_DAYS;
  let retentionDays =
    rawRetention !== undefined && rawRetention !== ''
      ? parseInt(process.env.WORKSPACE_RETENTION_DAYS ?? '', 10)
      : DEFAULT_RETENTION_DAYS;
  if (!Number.isFinite(retentionDays)) {
    logger.warn('workspace cleanup config: WORKSPACE_RETENTION_DAYS invalid, using default', {
      value: process.env.WORKSPACE_RETENTION_DAYS,
      default: DEFAULT_RETENTION_DAYS,
    });
    retentionDays = DEFAULT_RETENTION_DAYS;
  }
  const clampedRetention = Math.max(
    MIN_RETENTION_DAYS,
    Math.min(MAX_RETENTION_DAYS, retentionDays)
  );
  if (clampedRetention !== retentionDays) {
    logger.warn('workspace cleanup config: WORKSPACE_RETENTION_DAYS clamped to bounds', {
      value: retentionDays,
      clamped: clampedRetention,
      min: MIN_RETENTION_DAYS,
      max: MAX_RETENTION_DAYS,
    });
  }
  retentionDays = clampedRetention;

  const rawInterval = process.env.WORKSPACE_CLEANUP_INTERVAL_MS;
  let intervalMs =
    rawInterval !== undefined && rawInterval !== ''
      ? Math.floor(Number(process.env.WORKSPACE_CLEANUP_INTERVAL_MS)) // parseInt for large ms values can lose precision; floor(Number) is safe
      : WORKSPACE_CLEANUP_INTERVAL_MS_DEFAULT;
  if (!Number.isFinite(intervalMs)) {
    logger.warn('workspace cleanup config: WORKSPACE_CLEANUP_INTERVAL_MS invalid, using default', {
      value: process.env.WORKSPACE_CLEANUP_INTERVAL_MS,
      default: WORKSPACE_CLEANUP_INTERVAL_MS_DEFAULT,
    });
    intervalMs = WORKSPACE_CLEANUP_INTERVAL_MS_DEFAULT;
  }
  const clampedInterval = Math.max(
    MIN_INTERVAL_MS,
    Math.min(MAX_INTERVAL_MS, intervalMs)
  );
  if (clampedInterval !== intervalMs) {
    logger.warn('workspace cleanup config: WORKSPACE_CLEANUP_INTERVAL_MS clamped to bounds', {
      value: intervalMs,
      clamped: clampedInterval,
      min: MIN_INTERVAL_MS,
      max: MAX_INTERVAL_MS,
    });
  }
  intervalMs = clampedInterval;

  return { retentionDays, intervalMs };
}

app.get(
  '/workspace',
  asyncHandler(async (_req: Request, res: Response) => {
    const entries = listWorkspaceEntries();
    res.json({ entries });
  })
);

app.post(
  '/workspace/cleanup',
  asyncHandler(async (req: Request, res: Response) => {
    const { retentionDays: defaultRetention } = getValidatedWorkspaceCleanupConfig();
    const fromQuery = parseInt(String(req.query.retentionDays), 10);
    const fromEnv =
      process.env.WORKSPACE_RETENTION_DAYS !== undefined && process.env.WORKSPACE_RETENTION_DAYS !== ''
        ? parseInt(process.env.WORKSPACE_RETENTION_DAYS, 10)
        : NaN;
    const raw =
      (Number.isFinite(fromQuery) ? fromQuery : null) ??
      (Number.isFinite(fromEnv) ? fromEnv : null) ??
      defaultRetention;
    const retentionDays = Math.max(
      MIN_RETENTION_DAYS,
      Math.min(MAX_RETENTION_DAYS, raw)
    );
    const dryRun = req.query.dryRun === 'true' || req.query.dryRun === '1';
    const deleted = runWorkspaceCleanup(retentionDays, dryRun);
    res.json({ deleted, dryRun });
  })
);

app.get(
  '/queue',
  asyncHandler(async (req: Request, res: Response) => {
    const stats = getQueueStats();
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const statusFilter = req.query.status as 'pending' | 'processing' | 'done' | 'failed' | undefined;
    const jobs = listQueueJobs({
      limit,
      ...(statusFilter && ['pending', 'processing', 'done', 'failed'].includes(statusFilter)
        ? { status: statusFilter }
        : {}),
    });
    const finished = stats.pending === 0 && stats.processing === 0;
    res.json({
      stats,
      finished,
      jobs,
    });
  })
);

app.post(
  '/queue/trigger',
  asyncHandler(async (_req: Request, res: Response) => {
    const stats = getQueueStats();
    const hasWork = stats.pending > 0 || stats.processing > 0;
    if (!hasWork) {
      res.json({
        triggered: false,
        message: 'Queue is empty or already finished (no pending or processing jobs)',
      });
      return;
    }
    startWorker();
    res.json({
      triggered: true,
      message: 'Worker triggered to process next job',
      stats,
    });
  })
);

app.post(
  '/error',
  asyncHandler(async (req: Request, res: Response) => {
    const result = errorReportSchema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: 'Validation failed',
        details: z.flattenError(result.error),
      });
      return;
    }
    if (!result.data.source?.trim()) {
      res.status(400).json({
        error: 'source is required for self-healing pipeline',
      });
      return;
    }
    const jobId = enqueue(result.data);
    res.status(202).json({ accepted: true, jobId });
  })
);

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  handleError(err);
  res.status(500).json({ error: 'Internal Server Error' });
});

let isWorkerRunning = false;
let workerShouldStop = false;
let pollTimeoutId: ReturnType<typeof setTimeout> | null = null;

function runWorkerLoop(): void {
  if (workerShouldStop) {
    isWorkerRunning = false;
    return;
  }
  const job = claimNext();
  if (!job) {
    if (!workerShouldStop) {
      pollTimeoutId = setTimeout(runWorkerLoop, POLL_INTERVAL_MS);
    }
    return;
  }
  logger.info('worker claimed job', { jobId: job.id, source: job.report.source });
  runPipeline(job.report)
    .then(() => {
      setStatus(job.id, 'done');
      logger.info('worker job done', { jobId: job.id });
    })
    .catch((err) => {
      setStatus(job.id, 'failed');
      logger.warn('worker job failed', { jobId: job.id, error: String(err) });
    })
    .finally(() => {
      if (!workerShouldStop) runWorkerLoop();
    });
}

function startWorker(): void {
  if (isWorkerRunning) return;
  isWorkerRunning = true;
  workerShouldStop = false;
  runWorkerLoop();
}

function stopWorker(): void {
  workerShouldStop = true;
  if (pollTimeoutId) {
    clearTimeout(pollTimeoutId);
    pollTimeoutId = null;
  }
  isWorkerRunning = false;
}

function startWorkspaceCleanupSchedule(): void {
  const { retentionDays, intervalMs } = getValidatedWorkspaceCleanupConfig();

  function runCleanup(): void {
    try {
      const deleted = runWorkspaceCleanup(retentionDays, false);
      if (deleted.length > 0) {
        logger.info('workspace cleanup ran', { deletedCount: deleted.length, deleted });
      }
    } catch (err) {
      logger.warn('workspace cleanup error', { error: String(err) });
    }
  }

  setTimeout(() => {
    runCleanup();
    setInterval(runCleanup, intervalMs);
  }, WORKSPACE_CLEANUP_FIRST_DELAY_MS);
}

export { app, startWorker, stopWorker };

if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => {
    reclaimAbandonedOnStartup();
    logger.info('server started', {
      pid: process.pid,
      nodeVersion: process.version,
      env: process.env.NODE_ENV ?? 'development',
      port: Number(port),
      url: `http://localhost:${port}`,
    });
    startWorker();
    startWorkspaceCleanupSchedule();
  });
}
