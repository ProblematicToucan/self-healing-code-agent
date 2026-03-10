import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { claimNext, enqueue, setStatus } from './queue/db';
import { errorReportSchema } from './schemas/errorReport';
import { handleError, runPipeline } from './utils/errorHandler';

const POLL_INTERVAL_MS = 1500;

const app = express();
const port = process.env.PORT ?? 3000;

app.use(express.json());

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
  runPipeline(job.report)
    .then(() => setStatus(job.id, 'done'))
    .catch(() => setStatus(job.id, 'failed'))
    .finally(() => runWorkerLoop());
}

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
  runWorkerLoop();
});
