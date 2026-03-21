# OAuth 2.0 Client Credentials (JWT) — Design

**Date:** 2025-03-16  
**Status:** Approved (brainstorming session)

## Goal

Allow **machine-to-machine** access: another service authenticates with **client_id** + **client_secret**, obtains an **access token**, and calls this API with `Authorization: Bearer <token>`.

This service acts as **Authorization Server** (issues tokens) and **Resource Server** (validates tokens).

## Scope

- **Grant:** OAuth 2.0 **client credentials** only (`grant_type=client_credentials`).
- **Token format:** **JWT** (HS256), short-lived (default 1 hour). No refresh token (not required for client credentials).
- **Revocation:** Out of scope (YAGNI); rotate `client_secret` or shorten TTL.
- **Public routes (no Bearer):**
  - `GET /`
  - `GET /health`
  - `GET /openapi.json`
  - `GET /reference`
  - `POST /oauth/token` (token issuance)
- **Protected routes (Bearer required when OAuth is enabled):** all routes not listed above, including `GET /queue`, `POST /queue/trigger`, `POST /error`, `GET /workspace`, `POST /workspace/cleanup`.

## Activation

OAuth enforcement is **opt-in** via environment:

- **`OAUTH_JWT_SECRET`** — HMAC secret for signing/verifying JWTs (min length enforced in code, e.g. 32 chars).
- **`OAUTH_CLIENTS`** — JSON array: `[{"client_id":"...","client_secret":"..."}, ...]`.

If **both** are unset/empty → OAuth **disabled** (backward compatible for existing deployments).

If **only one** is set or JSON is invalid / empty clients → **fail fast at startup** with a clear error (misconfiguration).

## Token endpoint

- **Path:** `POST /oauth/token`
- **Body:** `application/json` or `application/x-www-form-urlencoded` with:
  - `grant_type=client_credentials`
  - `client_id`, `client_secret`
- **Success (200):** `{ "access_token": "<jwt>", "token_type": "Bearer", "expires_in": <seconds> }`
- **Errors:** RFC 6749-style `{ "error": "...", "error_description": "..." }` with appropriate status (`400`, `401`).

## Resource requests

- Header: `Authorization: Bearer <jwt>`
- Middleware verifies signature, `exp`, and optional `iss`/`aud` if we add them consistently.

## Security notes

- Compare `client_secret` with **timing-safe** comparison (`crypto.timingSafeEqual` on equal-length buffers).
- Never log client secrets or raw tokens at `info` level.
- Document that production must set strong `OAUTH_JWT_SECRET` and rotate client secrets via config.

## Dependencies

- **`jose`** — JWT sign/verify (modern, maintained).
