import { describe, it, expect } from 'vitest';
import { errorReportSchema } from './errorReport.js';

describe('errorReportSchema', () => {
  it('accepts valid report with required fields', () => {
    const result = errorReportSchema.safeParse({
      message: 'TypeError: x is undefined',
      branch: 'main',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.message).toBe('TypeError: x is undefined');
      expect(result.data.branch).toBe('main');
      expect(result.data.stack).toBeUndefined();
      expect(result.data.source).toBeUndefined();
    }
  });

  it('accepts full report with optional fields', () => {
    const result = errorReportSchema.safeParse({
      message: 'Error',
      stack: 'at foo.js:10:5',
      source: 'https://github.com/user/repo.git',
      branch: 'main',
      timestamp: '2025-03-11T12:00:00Z',
      metadata: { userId: '123' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.source).toBe('https://github.com/user/repo.git');
      expect(result.data.metadata).toEqual({ userId: '123' });
    }
  });

  it('rejects empty message', () => {
    const result = errorReportSchema.safeParse({
      message: '',
      branch: 'main',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing message', () => {
    const result = errorReportSchema.safeParse({
      branch: 'main',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty branch', () => {
    const result = errorReportSchema.safeParse({
      message: 'Error',
      branch: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing branch', () => {
    const result = errorReportSchema.safeParse({
      message: 'Error',
    });
    expect(result.success).toBe(false);
  });
});
