import { createHash, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { z } from 'zod';

const MIN_SECRET_LENGTH = 32;

const clientEntrySchema = z.object({
  client_id: z.string().min(1),
  client_secret: z.string().min(1),
});

const clientsSchema = z.array(clientEntrySchema);

/**
 * Parse `OAUTH_CLIENTS` JSON into a map. Duplicate `client_id` values throw.
 */
export function parseOAuthClientsJson(raw: string): Map<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('invalid JSON');
  }
  const result = clientsSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(result.error.message);
  }
  const map = new Map<string, string>();
  for (const c of result.data) {
    if (map.has(c.client_id)) {
      throw new Error(`duplicate client_id: ${c.client_id}`);
    }
    map.set(c.client_id, c.client_secret);
  }
  return map;
}

/**
 * Returns true when OAuth enforcement should apply: both env vars set and configuration is valid.
 */
export function isOAuthEnabled(): boolean {
  const rawSecret = process.env.OAUTH_JWT_SECRET?.trim() ?? '';
  const rawClients = process.env.OAUTH_CLIENTS?.trim() ?? '';
  if (!rawSecret || !rawClients) return false;
  return validateOAuthConfigAtStartup().ok;
}

/**
 * Validates OAuth env when enabling is intended. If both unset → ok (OAuth off).
 * If partially set or invalid → not ok.
 */
export function validateOAuthConfigAtStartup(): { ok: boolean; message?: string } {
  const rawSecret = process.env.OAUTH_JWT_SECRET?.trim() ?? '';
  const rawClients = process.env.OAUTH_CLIENTS?.trim() ?? '';
  if (!rawSecret && !rawClients) return { ok: true };
  if (!rawSecret || !rawClients) {
    return {
      ok: false,
      message:
        'Both OAUTH_JWT_SECRET and OAUTH_CLIENTS must be set to enable OAuth. Leave both unset to disable OAuth.',
    };
  }
  if (rawSecret.length < MIN_SECRET_LENGTH) {
    return {
      ok: false,
      message: `OAUTH_JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters.`,
    };
  }
  try {
    const clients = parseOAuthClientsJson(rawClients);
    if (clients.size === 0) {
      return { ok: false, message: 'OAUTH_CLIENTS must contain at least one client.' };
    }
  } catch (e) {
    return {
      ok: false,
      message: `OAUTH_CLIENTS: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  return { ok: true };
}

export function assertOAuthConfigOrThrow(): void {
  const r = validateOAuthConfigAtStartup();
  if (!r.ok) {
    throw new Error(r.message ?? 'Invalid OAuth configuration');
  }
}

function getJwtSecretBytes(): Uint8Array {
  return new TextEncoder().encode(process.env.OAUTH_JWT_SECRET!.trim());
}

export function getDefaultAccessTokenTtlSeconds(): number {
  const raw = process.env.OAUTH_ACCESS_TOKEN_TTL_SECONDS;
  const n =
    raw !== undefined && raw !== '' ? Math.floor(Number(raw)) : 3600;
  if (!Number.isFinite(n)) return 3600;
  return Math.max(60, Math.min(86400, n));
}

/**
 * Timing-safe comparison for secrets. Uses SHA-256 hashes so lengths are fixed (mitigates length leaks).
 */
export function safeCompareSecrets(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf8').digest();
  const hb = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ha, hb);
}

export function verifyClientCredentials(clientId: string, clientSecret: string): boolean {
  const raw = process.env.OAUTH_CLIENTS?.trim() ?? '';
  if (!raw) return false;
  let map: Map<string, string>;
  try {
    map = parseOAuthClientsJson(raw);
  } catch {
    return false;
  }
  const expected = map.get(clientId);
  if (expected === undefined) return false;
  return safeCompareSecrets(clientSecret, expected);
}

export async function issueAccessToken(clientId: string): Promise<{
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
}> {
  const ttl = getDefaultAccessTokenTtlSeconds();
  const secret = getJwtSecretBytes();
  const access_token = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(clientId)
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .sign(secret);

  return {
    access_token,
    token_type: 'Bearer',
    expires_in: ttl,
  };
}

export async function verifyAccessToken(token: string): Promise<{ clientId: string }> {
  const secret = getJwtSecretBytes();
  const { payload } = await jwtVerify(token, secret);
  const sub = payload.sub;
  if (!sub || typeof sub !== 'string') {
    throw new Error('invalid token: missing sub');
  }
  return { clientId: sub };
}
