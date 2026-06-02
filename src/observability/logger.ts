import pino, { type Logger } from 'pino';

export function createLogger(level: pino.LevelWithSilent = 'info'): Logger {
  return pino({
    level,
    base: { service: 'chatbot-backend' },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export type { Logger };
