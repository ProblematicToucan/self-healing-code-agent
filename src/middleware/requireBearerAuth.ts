import '../types/express-augment';
import type { NextFunction, Request, Response } from 'express';
import { isOAuthEnabled, verifyAccessToken } from '../auth/oauth';

function isPublicOAuthRoute(req: Request): boolean {
  if (req.method === 'GET' && (req.path === '/' || req.path === '/health')) {
    return true;
  }
  if (req.method === 'POST' && req.path === '/oauth/token') {
    return true;
  }
  return false;
}

/**
 * When OAuth is enabled, requires a valid Bearer JWT for all routes except
 * `GET /`, `GET /health`, and `POST /oauth/token`.
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
    res.status(401).json({
      error: 'invalid_request',
      error_description: 'Missing or invalid Authorization header (expected Bearer token)',
    });
    return;
  }
  const token = header.slice(7).trim();
  if (!token) {
    res.status(401).json({
      error: 'invalid_request',
      error_description: 'Empty Bearer token',
    });
    return;
  }

  void verifyAccessToken(token)
    .then(({ clientId }) => {
      req.oauthClientId = clientId;
      next();
    })
    .catch(() => {
      res.status(401).json({
        error: 'invalid_token',
        error_description: 'Access token is invalid or expired',
      });
    });
}
