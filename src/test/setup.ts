// Run before all tests: use in-memory queue DB and test env so server doesn't listen
process.env.NODE_ENV = 'test';
process.env.QUEUE_DB_PATH = ':memory:';
