import '../types/express-augment.js';
import type { NextFunction, Request, Response } from 'express';
import { isOAuthEnabled, verifyAccessToken } from '../auth/oauth.js';

function buildBearerWwwAuthenticateValue(
  error: 'invalid_request' | 'invalid_token',
  description: string
): string {
  const escaped = description.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `Bearer realm="API", error="${error}", error_description="${escaped}"`;
}

function sendBearerAuthError(
  res: Response,
  error: 'invalid_request' | 'invalid_token',
  description: string
): void {
  res.setHeader('WWW-Authenticate', buildBearerWwwAuthenticateValue(error, description));
  res.status(401).json({ error, error_description: description });
}

function isPublicOAuthRoute(req: Request): boolean {
  if (
    (req.method === 'GET' || req.method === 'HEAD') &&
    (req.path === '/' ||
      req.path === '/health' ||
      req.path === '/openapi.json' ||
      req.path === '/reference')
  ) {
    return true;
  }
  if (req.method === 'POST' && req.path === '/oauth/token') {
    return true;
  }
  return false;
}

/**
 * When OAuth is enabled, requires a valid Bearer JWT for all routes except
 * `GET`/`HEAD /`, `GET`/`HEAD /health`, `GET`/`HEAD /openapi.json`, `GET`/`HEAD /reference`, and `POST /oauth/token`.
 */
export function requireBearerAuth(req: Request, res: Response, next: NextFunction): void {
  if (!isOAuthEnabled()) {
    next();
    return;
  }
  if (isPublicOAuthRoute(req)) {
    next();
    return;
  }

  const header = req.headers.authorization;
  if (!header || !header.toLowerCase().startsWith('bearer ')) {
    sendBearerAuthError(
      res,
      'invalid_request',
      'Missing or invalid Authorization header (expected Bearer token)'
    );
    return;
  }
  const token = header.slice(7).trim();
  if (!token) {
    sendBearerAuthError(res, 'invalid_request', 'Empty Bearer token');
    return;
  }

  void verifyAccessToken(token)
    .then(({ clientId }) => {
      req.oauthClientId = clientId;
      next();
    })
    .catch(() => {
      sendBearerAuthError(res, 'invalid_token', 'Access token is invalid or expired');
    });
}
