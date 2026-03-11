import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { claimNext, enqueue, setStatus } from './queue/db';
import { errorReportSchema } from './schemas/errorReport';
import { handleError, runPipeline } from './utils/errorHandler';
import { logger } from './utils/logger';

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

function runWorkerLoop(): void {
  const job = claimNext();
  if (!job) {
    setTimeout(runWorkerLoop, POLL_INTERVAL_MS);
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
    .finally(() => runWorkerLoop());
}

app.listen(port, () => {
  logger.info('server started', {
    pid: process.pid,
    nodeVersion: process.version,
    env: process.env.NODE_ENV ?? 'development',
    port: Number(port),
    url: `http://localhost:${port}`,
  });
  runWorkerLoop();
});
