import { logger } from './logger.js';

/**
 * Options for getEnvInt helper.
 */
interface GetEnvIntOptions {
  min?: number;
  max?: number;
  context?: string;
}

/**
 * Parses an integer from an environment variable with a default value and optional bounds.
 * If context is provided, it logs warnings for invalid or clamped values.
 */
export function getEnvInt(
  key: string,
  defaultValue: number,
  options: GetEnvIntOptions = {}
): number {
  const raw = process.env[key];
  if (raw === undefined || raw === '') {
    return defaultValue;
  }

  const parsed = Number(raw);
  const value = Math.floor(parsed);

  if (!Number.isFinite(value)) {
    if (options.context) {
      logger.warn(`${options.context}: ${key} invalid, using default`, {
        value: raw,
        default: defaultValue,
      });
    }
    return defaultValue;
  }

  const { min, max } = options;
  const clamped = Math.max(
    min !== undefined ? min : -Infinity,
    Math.min(max !== undefined ? max : Infinity, value)
  );

  if (clamped !== value && options.context) {
    logger.warn(`${options.context}: ${key} clamped to bounds`, {
      value,
      clamped,
      min,
      max,
    });
  }

  return clamped;
}
