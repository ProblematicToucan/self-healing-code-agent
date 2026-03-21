import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  parseOAuthClientsJson,
  safeCompareSecrets,
  validateOAuthConfigAtStartup,
} from './oauth.js';

describe('parseOAuthClientsJson', () => {
  it('parses valid JSON array into a map', () => {
    const map = parseOAuthClientsJson(
      JSON.stringify([{ client_id: 'a', client_secret: 's1' }])
    );
    expect(map.get('a')).toBe('s1');
    expect(map.size).toBe(1);
  });

  it('throws on duplicate client_id', () => {
    expect(() =>
      parseOAuthClientsJson(
        JSON.stringify([
          { client_id: 'dup', client_secret: 'x' },
          { client_id: 'dup', client_secret: 'y' },
        ])
      )
    ).toThrow(/duplicate client_id/);
  });

  it('parses double-encoded JSON (env UIs that JSON-stringify the array)', () => {
    const inner = JSON.stringify([{ client_id: 'a', client_secret: 's1' }]);
    const asStoredBySomeHosts = JSON.stringify(inner);
    const map = parseOAuthClientsJson(asStoredBySomeHosts);
    expect(map.get('a')).toBe('s1');
  });
});

describe('safeCompareSecrets', () => {
  it('returns true for equal strings', () => {
    expect(safeCompareSecrets('same', 'same')).toBe(true);
  });

  it('returns false for different strings', () => {
    expect(safeCompareSecrets('a', 'b')).toBe(false);
  });
});

describe('validateOAuthConfigAtStartup', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns ok when both OAuth vars are unset', () => {
    vi.stubEnv('OAUTH_JWT_SECRET', '');
    vi.stubEnv('OAUTH_CLIENTS', '');
    expect(validateOAuthConfigAtStartup().ok).toBe(true);
  });

  it('returns not ok when only secret is set', () => {
    vi.stubEnv('OAUTH_JWT_SECRET', 'x'.repeat(32));
    vi.stubEnv('OAUTH_CLIENTS', '');
    expect(validateOAuthConfigAtStartup().ok).toBe(false);
  });

  it('returns not ok when secret is too short', () => {
    vi.stubEnv('OAUTH_JWT_SECRET', 'short');
    vi.stubEnv('OAUTH_CLIENTS', JSON.stringify([{ client_id: 'a', client_secret: 'b' }]));
    expect(validateOAuthConfigAtStartup().ok).toBe(false);
  });
});
