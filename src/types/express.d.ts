import 'express';

declare global {
  namespace Express {
    interface Request {
      /** Set by `requireBearerAuth` after successful JWT verification. */
      oauthClientId?: string;
    }
  }
}

export {};
