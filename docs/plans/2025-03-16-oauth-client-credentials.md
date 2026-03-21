# OAuth 2.0 Client Credentials — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add optional OAuth 2.0 client-credentials flow: `POST /oauth/token` issues JWTs; when `OAUTH_JWT_SECRET` + `OAUTH_CLIENTS` are set, all routes except `GET /`, `GET /health`, and `POST /oauth/token` require `Authorization: Bearer <jwt>`.

**Architecture:** Load clients from `OAUTH_CLIENTS` JSON; sign HS256 JWTs with `jose`; `requireBearerAuth` middleware skips public routes and returns 401 JSON when OAuth is enabled and token is missing/invalid. Startup validates partial/malformed OAuth env and exits.

**Tech Stack:** Express 5, TypeScript, `jose`, Vitest + supertest, existing `src/test/setup.ts`.

---

### Task 1: Add `jose` dependency

**Files:**
- Modify: `package.json`

**Step 1:** Run `npm install jose`

**Step 2:** Commit: `feat(deps): add jose for OAuth JWT`

---

### Task 2: `src/auth/oauth.ts` — config, issue, verify, startup validation

**Files:**
- Create: `src/auth/oauth.ts`

**Implement:**

1. `parseOAuthClients(): Map<string, string>` — read `OAUTH_CLIENTS`, parse JSON, validate with zod (`client_id`, `client_secret` non-empty strings). Return `Map`.
2. `isOAuthEnabled(): boolean` — true iff `OAUTH_JWT_SECRET` (trimmed) length ≥ 32 and `OAUTH_CLIENTS` parses to at least one client.
3. `validateOAuthConfigAtStartup(): { ok: boolean; message?: string }` — if either `OAUTH_JWT_SECRET` or `OAUTH_CLIENTS` is partially set (one without the other, or invalid JSON, or empty array, or secret too short) return `ok: false` with message; else `ok: true`.
4. `issueAccessToken(clientId: string): Promise<{ access_token: string; expires_in: number }>` — `SignJWT` with `sub: clientId`, `exp` from `OAUTH_ACCESS_TOKEN_TTL_SECONDS` (default 3600).
5. `verifyAccessToken(token: string): Promise<{ clientId: string }>` — `jwtVerify` with same secret; return `sub` as `clientId`.
6. `safeCompareSecrets(a: string, b: string): boolean` — timing-safe compare (handle length mismatch without leaking).

**Export:** all of the above plus constants for default TTL.

**Step 1:** Add unit tests `src/auth/oauth.test.ts` for `safeCompareSecrets`, `validateOAuthConfigAtStartup` with `vi.stubEnv` / restore.

**Step 2:** Run `npm run test:run -- src/auth/oauth.test.ts`

---

### Task 3: `src/middleware/requireBearerAuth.ts`

**Files:**
- Create: `src/middleware/requireBearerAuth.ts`

**Implement:** Middleware: if `!isOAuthEnabled()` → `next()`. If `isPublicOAuthRoute(req)` (`GET /`, `GET /health`, `POST /oauth/token`) → `next()`. Else read `Authorization` header; if missing or not `Bearer ` → 401 `{ error: 'invalid_request', error_description: '...' }`. Else verify token; on failure 401 `{ error: 'invalid_token', ... }`. On success optionally set `req.oauthClientId = clientId` and `next()`.

**Extend:** Add minimal `Request` augmentation in `src/types/express.d.ts` or inline `declare global` for `oauthClientId?: string`.

---

### Task 4: `POST /oauth/token` + wire middleware in `index.ts`

**Files:**
- Modify: `src/index.ts`

**Implement:**

1. `app.use(express.urlencoded({ extended: false }));` after `express.json()`.
2. At startup (only when `NODE_ENV !== 'test'` OR always): call `validateOAuthConfigAtStartup()`; if `!ok`, `logger.error` + `process.exit(1)` — **in test**, same validation but avoid `exit` if we run tests with valid env: use valid env in setup always, or skip exit in test. **Prefer:** validate in module init; if `NODE_ENV === 'test'`, throw instead of exit so Vitest reports failure. Actually **simpler:** validate only in `listen` callback for non-test; for test, rely on setup. **Better:** `validateOAuthConfigAtStartup()` in `index.ts` after imports: if `!ok && process.env.NODE_ENV !== 'test'` then `process.exit(1)`; if test and `!ok` throw `Error(message)` so misconfigured tests fail.

   Simpler approach: **always** if `!ok` throw `Error` in a function `assertOAuthConfig()` called from `app.listen` block only (non-test). Tests import `app` without calling listen — **no startup validation** in tests unless we call `assertOAuthConfig()` from test setup. **Risk:** production could misconfigure and only fail when binding port. **Better:** call `assertOAuthConfig()` at bottom of `oauth.ts` import side-effect — no, bad.

   **Final:** Export `assertOAuthConfigOrThrow()` from `oauth.ts`; call it at top of `index.ts` after dotenv (always). In tests, `setup.ts` sets valid env before any import — Vitest loads `setupFiles` before test file; test file imports `./index` which loads oauth — order: setup → test file → index → oauth reads env. **Good.**

   If test file imports index before setup? Vitest order: setupFiles run first. **Good.**

3. Register `POST /oauth/token` handler: parse body (json or urlencoded), check `grant_type === 'client_credentials'`, lookup client with `safeCompareSecrets`, return token or RFC 6749 errors.
4. `app.use(requireBearerAuth)` after logging, before routes — **order:** actually token route must be registered **before** `requireBearerAuth`, OR `requireBearerAuth` skips `/oauth/token`. **Already skipping in middleware.** So: `app.use(requireBearerAuth)` then all routes — **wrong:** middleware runs first for all; public skip works. Register routes after middleware? **Express order:** middleware applies to routes defined **after** it. So:

```ts
app.use(requireBearerAuth);
app.get('/', ...);
```

   **But** then `POST /oauth/token` must be registered — if registered after `requireBearerAuth`, middleware runs first — `isPublicRoute` allows `POST /oauth/token` — **OK**.

5. **Critical:** `POST /oauth/token` is defined **after** `requireBearerAuth` — middleware runs first; for `/oauth/token` POST, middleware skips auth — **OK**.

---

### Task 5: Tests + `src/test/setup.ts`

**Files:**
- Modify: `src/test/setup.ts` — set `OAUTH_JWT_SECRET` (≥32 chars), `OAUTH_CLIENTS` JSON for `test-client` / `test-secret`.
- Modify: `src/index.test.ts` — helper `getAccessToken()` via `request(app).post('/oauth/token').send({...})`; add tests: without Bearer → 401 on `/queue` with OAuth; with Bearer → 200; token endpoint bad client → 401.

**Step 1:** Run `npm run test:run`

---

### Task 6: `.env.example` + README API table

**Files:**
- Modify: `.env.example`, `README.md`

Document `OAUTH_JWT_SECRET`, `OAUTH_CLIENTS`, optional `OAUTH_ACCESS_TOKEN_TTL_SECONDS`, and OAuth section for callers.

---

**Plan complete.** Execution options: (1) subagent-driven in this session, or (2) separate session with executing-plans.
