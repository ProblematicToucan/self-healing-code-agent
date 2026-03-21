/**
 * Side-effect module: merges `oauthClientId` onto Express `Request`.
 * Imported from middleware so ts-node-dev always loads this (unlike orphan `.d.ts` files).
 */
declare module 'express-serve-static-core' {
  interface Request {
    /** Set by `requireBearerAuth` after successful JWT verification. */
    oauthClientId?: string;
  }
}

export {};
