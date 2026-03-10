const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
type LogLevel = (typeof LOG_LEVELS)[number];

const minLevelIndex = LOG_LEVELS.indexOf(
  (process.env.LOG_LEVEL?.toLowerCase() as LogLevel) || 'info'
);

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS.indexOf(level) >= minLevelIndex;
}

function formatEntry(level: LogLevel, message: string, data?: Record<string, unknown>): string {
  const timestamp = new Date().toISOString();
  const base = JSON.stringify({
    ts: timestamp,
    level,
    msg: message,
    ...(data && Object.keys(data).length > 0 ? data : {}),
  });
  return base;
}

export const logger = {
  debug(message: string, data?: Record<string, unknown>): void {
    if (shouldLog('debug')) {
      console.debug(formatEntry('debug', message, data));
    }
  },
  info(message: string, data?: Record<string, unknown>): void {
    if (shouldLog('info')) {
      console.info(formatEntry('info', message, data));
    }
  },
  warn(message: string, data?: Record<string, unknown>): void {
    if (shouldLog('warn')) {
      console.warn(formatEntry('warn', message, data));
    }
  },
  error(message: string, data?: Record<string, unknown>): void {
    if (shouldLog('error')) {
      console.error(formatEntry('error', message, data));
    }
  },
};
