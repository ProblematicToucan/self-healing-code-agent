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

  it('repairs trailing comma before closing bracket (invalid JSON)', () => {
    const map = parseOAuthClientsJson('[{"client_id":"a","client_secret":"b",}]');
    expect(map.get('a')).toBe('b');
  });

  it('repairs JavaScript-style single-quoted keys (Coolify / env UIs)', () => {
    const map = parseOAuthClientsJson(
      "[{'client_id':'test-m2m-client','client_secret':'fake-secret-not-for-production'}]"
    );
    expect(map.get('test-m2m-client')).toBe('fake-secret-not-for-production');
  });

  it('includes JSON.parse diagnostic in error for malformed input', () => {
    expect(() => parseOAuthClientsJson('not json')).toThrow(/invalid JSON/);
    expect(() => parseOAuthClientsJson('not json')).toThrow(/JSON/);
  });

  it('parses double-encoded JSON (env UIs that JSON-stringify the array)', () => {
    const inner = JSON.stringify([{ client_id: 'a', client_secret: 's1' }]);
    const asStoredBySomeHosts = JSON.stringify(inner);
    const map = parseOAuthClientsJson(asStoredBySomeHosts);
    expect(map.get('a')).toBe('s1');
  });

  it('accepts a single client object (not wrapped in array)', () => {
    const map = parseOAuthClientsJson(
      JSON.stringify({ client_id: 'solo', client_secret: 'sec' })
    );
    expect(map.get('solo')).toBe('sec');
  });

  it('normalizes curly double quotes from copy-paste', () => {
    const map = parseOAuthClientsJson(
      '[{\u201cclient_id\u201d:\u201ca\u201d,\u201cclient_secret\u201d:\u201cs\u201d}]'
    );
    expect(map.get('a')).toBe('s');
  });

  it('unwraps outer single-quote wrapper', () => {
    const map = parseOAuthClientsJson(
      `'${JSON.stringify([{ client_id: 'a', client_secret: 's1' }])}'`
    );
    expect(map.get('a')).toBe('s1');
  });

  it('parses URL-encoded payload', () => {
    const json = JSON.stringify([{ client_id: 'a', client_secret: 's&1' }]);
    const map = parseOAuthClientsJson(encodeURIComponent(json));
    expect(map.get('a')).toBe('s&1');
  });

  it('parses base64-encoded UTF-8 JSON', () => {
    const json = JSON.stringify([{ client_id: 'a', client_secret: 's1' }]);
    const b64 = Buffer.from(json, 'utf8').toString('base64');
    const map = parseOAuthClientsJson(b64);
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
