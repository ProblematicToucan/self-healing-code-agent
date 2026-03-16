import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  claimNext,
  enqueue,
  getQueueStats,
  listQueueJobs,
  reclaimAbandonedOnStartup,
  setStatus,
} from './queue/db';
import { errorReportSchema } from './schemas/errorReport';
import { handleError, runPipeline } from './utils/errorHandler';
import { logger } from './utils/logger';
import { listWorkspaceEntries, runWorkspaceCleanup } from './utils/workspaceCleanup';

const POLL_INTERVAL_MS = 1500;

const app = express();
const port = process.env.PORT ?? 3000;

app.use(express.json());

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

const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

app.get(
  '/',
  asyncHandler(async (_req: Request, res: Response) => {
    res.json({ message: 'Hello from Express + TypeScript' });
  })
);

app.get(
  '/health',
  asyncHandler(async (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  })
);

const DEFAULT_RETENTION_DAYS = 2;
const WORKSPACE_CLEANUP_FIRST_DELAY_MS = 60 * 1000; // 1 minute
const WORKSPACE_CLEANUP_INTERVAL_MS_DEFAULT = 6 * 60 * 60 * 1000; // 6 hours

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
    const retentionDays = Math.max(
      1,
      Math.min(365, Number(req.query.retentionDays) || Number(process.env.WORKSPACE_RETENTION_DAYS) || DEFAULT_RETENTION_DAYS)
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
  const retentionDays = Number(process.env.WORKSPACE_RETENTION_DAYS) || DEFAULT_RETENTION_DAYS;
  const intervalMs = Number(process.env.WORKSPACE_CLEANUP_INTERVAL_MS) || WORKSPACE_CLEANUP_INTERVAL_MS_DEFAULT;

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
