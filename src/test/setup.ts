// Run before all tests: use in-memory queue DB and test env so server doesn't listen
process.env.NODE_ENV = 'test';
process.env.QUEUE_DB_PATH = ':memory:';

// OAuth: required because `assertOAuthConfigOrThrow` runs when importing `src/index.ts`
process.env.OAUTH_JWT_SECRET = 'test-oauth-secret-min-32-characters-long!!';
process.env.OAUTH_CLIENTS = JSON.stringify([
  { client_id: 'test-client', client_secret: 'test-secret' },
]);
