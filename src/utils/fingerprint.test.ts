import { describe, it, expect } from 'vitest';
import { errorReportFingerprint } from './fingerprint.js';

describe('errorReportFingerprint', () => {
  it('returns a 64-char hex string (SHA-256)', () => {
    const fp = errorReportFingerprint({
      message: 'Error',
      branch: 'main',
    });
    expect(fp).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is stable for same report', () => {
    const report = {
      message: 'TypeError: x of undefined',
      stack: 'at foo.js:10:5',
      source: 'https://github.com/a/b.git',
      branch: 'main',
    };
    expect(errorReportFingerprint(report)).toBe(errorReportFingerprint(report));
  });

  it('differs when message changes', () => {
    const base = { message: 'Error A', branch: 'main' };
    const other = { message: 'Error B', branch: 'main' };
    expect(errorReportFingerprint(base)).not.toBe(errorReportFingerprint(other));
  });

  it('differs when branch changes', () => {
    const base = { message: 'Error', branch: 'main' };
    const other = { message: 'Error', branch: 'develop' };
    expect(errorReportFingerprint(base)).not.toBe(errorReportFingerprint(other));
  });

  it('differs when source changes', () => {
    const base = { message: 'Error', branch: 'main', source: 'https://github.com/a/b.git' };
    const other = { message: 'Error', branch: 'main', source: 'https://github.com/c/d.git' };
    expect(errorReportFingerprint(base)).not.toBe(errorReportFingerprint(other));
  });

  it('handles undefined stack and source', () => {
    const fp = errorReportFingerprint({ message: 'Err', branch: 'main' });
    expect(fp).toMatch(/^[a-f0-9]{64}$/);
  });

  it('trims message, source, and branch', () => {
    const report = {
      message: '  Error  ',
      branch: '  main  ',
      source: '  https://github.com/x/y.git  ',
    };
    const fp = errorReportFingerprint(report);
    expect(fp).toMatch(/^[a-f0-9]{64}$/);
    // Same trimmed content gives same fingerprint
    expect(fp).toBe(
      errorReportFingerprint({
        message: 'Error',
        branch: 'main',
        source: 'https://github.com/x/y.git',
      })
    );
  });
});
