import { z } from 'zod';

export const errorReportSchema = z.object({
  message: z.string().min(1, 'message is required'),
  stack: z.string().optional(),
  source: z.string().optional(),
  timestamp: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type ErrorReport = z.infer<typeof errorReportSchema>;
