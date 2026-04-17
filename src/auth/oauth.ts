import { createHash, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { z } from 'zod';

const MIN_SECRET_LENGTH = 32;

const clientEntrySchema = z.object({
  client_id: z.string().min(1),
  client_secret: z.string().min(1),
});

const clientsSchema = z.array(clientEntrySchema);

const MAX_JSON_UNWRAP = 4;

/** Smart / typographic quotes → ASCII `"` or `'`. */
function normalizeEnvQuotes(s: string): string {
  return s
    .replace(/[\u2018\u2019\u201a\u201b]/g, "'")
    .replace(/[\u201c\u201d\u201e\u201f\u00ab\u00bb]/g, '"');
}

/**
 * Docker / Coolify often inject JSON with escaped quotes: [{\"client_id\":\"x\",...}]
 * (literal backslash + quote). JSON.parse rejects that; collapse to real ".
 */
function collapseEscapedDoubleQuotes(s: string): string {
  if (!s.includes('\\"')) return s;
  return s.replace(/\\"/g, '"');
}

function stripTrailingCommasBeforeClosingBrackets(s: string): string {
  let t = s.trim();
  for (let i = 0; i < 8; i++) {
    const next = t.replace(/,\s*\]$/, ']').replace(/,\s*\}\s*\]$/, '}]');
    if (next === t) break;
    t = next;
  }
  return t;
}

function looksLikeSingleQuotedJsonKeys(s: string): boolean {
  const t = s.trim();
  return /^\[\s*\{\s*'/.test(t) || /^\{\s*'/.test(t);
}

/** Pseudo-JSON with single-quoted keys (not valid JSON). */
function repairSingleQuotedJsonKeys(s: string): string {
  if (!looksLikeSingleQuotedJsonKeys(s)) return s;
  let t = s.replace(/[\u2018\u2019\u201a\u201b]/g, "'");
  return t.replace(/'/g, '"');
}

function normalizeOAuthClientsEnvString(raw: string): string {
  let s = raw.trim();
  if (s.startsWith('\ufeff')) s = s.slice(1);
  if (s.includes('\0')) s = s.replace(/\0/g, '');
  s = normalizeEnvQuotes(s);
  if (s.length >= 2 && s[0] === "'" && s[s.length - 1] === "'") {
    const inner = s.slice(1, -1).trim();
    if (inner.startsWith('[') || inner.startsWith('{') || inner.startsWith('"')) {
      s = inner;
    }
  }
  if (s.startsWith('[')) {
    s = stripTrailingCommasBeforeClosingBrackets(s);
  }
  return s;
}

function parseJsonDocument(s: string): unknown {
  let lastErr: unknown;
  const attempts: string[] = [s];
  const collapsed = collapseEscapedDoubleQuotes(s);
  if (collapsed !== s) attempts.push(collapsed);
  const singleFixed = repairSingleQuotedJsonKeys(s);
  if (singleFixed !== s) attempts.push(singleFixed);
  const both = repairSingleQuotedJsonKeys(collapsed);
  if (both !== collapsed && !attempts.includes(both)) attempts.push(both);

  for (const t of attempts) {
    try {
      return JSON.parse(t);
    } catch (e) {
      lastErr = e;
    }
  }
  const detail = lastErr instanceof SyntaxError ? lastErr.message : 'parse failed';
  throw new Error(`invalid JSON (${detail})`);
}

function unwrapJsonStringLayers(s: string): unknown {
  for (let depth = 0; depth < MAX_JSON_UNWRAP; depth++) {
    let parsed: unknown;
    try {
      parsed = parseJsonDocument(s);
    } catch (e) {
      throw e instanceof Error ? e : new Error('invalid JSON');
    }
    if (typeof parsed !== 'string') return parsed;
    const inner = parsed.trim();
    if (!inner.startsWith('[') && !inner.startsWith('{')) return parsed;
    s = inner;
  }
  throw new Error('invalid JSON');
}

function tryDecodeBase64JsonPayload(s: string): string | null {
  const compact = s.replace(/\s+/g, '');
  if (compact.length < 8) return null;
  if (!/^[A-Za-z0-9+/]+=*$/.test(compact)) return null;
  try {
    const decoded = Buffer.from(compact, 'base64').toString('utf8').trim();
    if (decoded.startsWith('[') || decoded.startsWith('{')) return decoded;
  } catch {
    /* ignore */
  }
  return null;
}

function parseJsonClientsPayload(raw: string): unknown {
  const base = normalizeOAuthClientsEnvString(raw);
  const candidates: string[] = [base];
  if (base.includes('%')) {
    try {
      const decoded = decodeURIComponent(base);
      if (decoded !== base) candidates.push(decoded);
    } catch {
      /* ignore */
    }
  }
  const b64 = tryDecodeBase64JsonPayload(base);
  if (b64 !== null) candidates.push(b64);

  let lastErr: Error | undefined;
  for (const candidate of candidates) {
    try {
      return unwrapJsonStringLayers(candidate);
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastErr ?? new Error('invalid JSON');
}

/**
 * Parse `OAUTH_CLIENTS` JSON into a map. Duplicate `client_id` values throw.
 */
export function parseOAuthClientsJson(raw: string): Map<string, string> {
  let parsed: unknown;
  try {
    parsed = parseJsonClientsPayload(raw);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('invalid JSON')) {
      throw e;
    }
    throw new Error('invalid JSON');
  }
  if (
    parsed !== null &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    'client_id' in parsed &&
    'client_secret' in parsed
  ) {
    parsed = [parsed];
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
    const detail = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      message: `OAUTH_CLIENTS: ${detail}`,
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

let cachedJwtSecret: Uint8Array | undefined;
const encoder = new TextEncoder();

function getJwtSecretBytes(): Uint8Array {
  if (!cachedJwtSecret) {
    cachedJwtSecret = encoder.encode(process.env.OAUTH_JWT_SECRET!.trim());
  }
  return cachedJwtSecret;
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
