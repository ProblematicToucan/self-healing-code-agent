import { createHash } from 'node:crypto';
import type { ErrorReport } from '../schemas/errorReport';

/** Normalize stack to first N lines to avoid minor line-number drift counting as different. */
const STACK_LINES = 10;
const STACK_MAX_CHARS = 800;

function normalizeStack(stack: string | undefined): string {
  if (!stack?.trim()) return '';
  const lines = stack.trim().split('\n').slice(0, STACK_LINES);
  const joined = lines.join('\n');
  return joined.length > STACK_MAX_CHARS ? joined.slice(0, STACK_MAX_CHARS) : joined;
}

/**
 * Compute a stable fingerprint for an error report so the same logical issue
 * (same message, stack trace, source, branch) is treated as one.
 */
export function errorReportFingerprint(report: ErrorReport): string {
  const message = report.message?.trim() ?? '';
  const stack = normalizeStack(report.stack);
  const source = report.source?.trim() ?? '';
  const branch = report.branch?.trim() ?? '';
  const payload = [message, stack, source, branch].join('\0');
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}
