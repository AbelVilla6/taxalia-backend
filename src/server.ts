import { serve } from '@hono/node-server';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import { loadConfig, type Env } from './config.js';
import { buildChatRouter } from './chat/routes.js';
import { createLogger } from './observability/logger.js';
import { requestIdMiddleware } from './observability/requestId.js';

function createCorsGuard(allowlist: string[]): MiddlewareHandler {
  return async (c: Context, next) => {
    const origin = c.req.header('Origin');
    if (origin && !allowlist.includes(origin)) {
      console.warn(
        JSON.stringify({
          requestId: c.get('requestId'),
          origin,
          action: 'cors-rejected',
        }),
      );
      return c.body(null, 403);
    }
    await next();
  };
}

export function createApp(env: Env): Hono {
  const app = new Hono();

  const allowlist = env.CORS_ALLOWED_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  app.use('*', requestIdMiddleware);
  app.use('*', createCorsGuard(allowlist));
  app.use(
    '*',
    cors({
      origin: allowlist,
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Accept', 'X-Request-Id'],
      credentials: false,
    }),
  );

  app.route('/', buildChatRouter());

  return app;
}

function isMainEntry(): boolean {
  if (typeof process === 'undefined') return false;
  const entry = process.argv[1];
  if (!entry) return false;
  return entry.endsWith('server.ts') || entry.endsWith('server.js');
}

function main(): void {
  const env = loadConfig();
  const app = createApp(env);
  const logger = createLogger(env.LOG_LEVEL);
  serve(
    { fetch: app.fetch, port: env.PORT },
    (info) => {
      logger.info(
        {
          port: info.port,
          ollamaHost: env.OLLAMA_HOST,
          allowlist: env.CORS_ALLOWED_ORIGINS.split(','),
        },
        'chatbot-backend listening',
      );
    },
  );
}

if (isMainEntry()) {
  main();
}
