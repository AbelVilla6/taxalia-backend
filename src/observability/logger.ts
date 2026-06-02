import pino, { type Logger } from 'pino';

export function createLogger(level: pino.LevelWithSilent = 'info'): Logger {
  return pino({
    level,
    base: { service: 'chatbot-backend' },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

let cached: Logger | null = null;

function resolveDefaultLevel(): pino.LevelWithSilent {
  const fromEnv = process.env.LOG_LEVEL;
  if (
    fromEnv === 'fatal' ||
    fromEnv === 'error' ||
    fromEnv === 'warn' ||
    fromEnv === 'info' ||
    fromEnv === 'debug' ||
    fromEnv === 'trace' ||
    fromEnv === 'silent'
  ) {
    return fromEnv;
  }
  if (process.env.NODE_ENV === 'test') return 'silent';
  return 'info';
}

/**
 * Returns the process-wide default logger. Honors LOG_LEVEL from the
 * environment and falls back to `silent` under NODE_ENV=test so that
 * vitest output stays clean by default. Use `createLogger` if you need
 * an isolated, level-specific logger (e.g. boot in server.ts).
 */
export function getDefaultLogger(): Logger {
  if (!cached) cached = createLogger(resolveDefaultLevel());
  return cached;
}

/** Test seam — drop the cached singleton between specs if needed. */
export function resetDefaultLogger(): void {
  cached = null;
}

export type { Logger };
