import { serve } from '@hono/node-server';
import { handle } from '@hono/node-server/vercel';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import { loadConfig, type Env } from './config.js';
import { buildChatRouter } from './chat/routes.js';
import { createArtifactRegistry } from './loaders/registry.js';
import { createLogger, getDefaultLogger, type Logger } from './observability/logger.js';
import { requestIdMiddleware } from './observability/requestId.js';
import { createOllamaClient } from './ollama/client.js';
import { Semaphore } from './dispatch/semaphore.js';
import { ColdStartGate } from './chat/coldStart.js';

function createCorsGuard(allowlist: string[], logger: Logger): MiddlewareHandler {
  return async (c: Context, next) => {
    const origin = c.req.header('Origin');

    if (c.req.method === 'OPTIONS') {
      await next();
      return;
    }

    if (origin && !allowlist.includes(origin)) {
      logger.warn(
        {
          stage: 'cors',
          action: 'rejected',
          requestId: c.get('requestId'),
          origin,
          allowlist,
        },
        'CORS origin not in allowlist',
      );

      return c.json(
        {
          error: 'CORS_ORIGIN_NOT_ALLOWED',
          origin,
        },
        403,
      );
    }

    await next();
  };
}

export function createApp(env: Env, registry = createArtifactRegistry()): Hono {
  const app = new Hono();
  const logger = getDefaultLogger();

  app.onError((err, c) => {
    logger.error(
      {
        err,
        requestId: c.req.header('X-Request-Id') ?? 'unknown',
        path: c.req.path,
        method: c.req.method,
      },
      'Unhandled backend error',
    );

    return c.json(
      {
        error: 'INTERNAL_SERVER_ERROR',
        message: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  });

  const allowlist = env.CORS_ALLOWED_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  app.use('*', requestIdMiddleware);

  app.use(
    '*',
    cors({
      origin: allowlist,
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Accept', 'X-Request-Id', 'Authorization'],
      credentials: false,
    }),
  );

  app.use('*', createCorsGuard(allowlist, logger));

  const client = createOllamaClient({
    host: env.OLLAMA_HOST,
    model: env.OLLAMA_MODEL,
    apiKey: env.OLLAMA_API_KEY,
    timeoutMs: env.OLLAMA_AGENT_TIMEOUT_MS,
  });
  const semaphore = new Semaphore(env.DISPATCH_CONCURRENCY_CAP);
  const coldStart = new ColdStartGate(60_000);

  app.get('/health/ollama', async (c) => {
    try {
      await client.checkModel();

      return c.json({
        ok: true,
        ollamaHost: env.OLLAMA_HOST,
      });
    } catch (err) {
      return c.json(
        {
          ok: false,
          ollamaHost: env.OLLAMA_HOST,
          error: err instanceof Error ? err.message : String(err),
          code: (err as { code?: string } | null)?.code,
        },
        500,
      );
    }
  });

  app.get('/', (c) => {
    return c.json({
      ok: true,
      service: 'taxalia-chat-backend',
    });
  });

  app.get('/health', (c) => {
    return c.json({
      ok: true,
    });
  });

  app.route(
    '/',
    buildChatRouter(registry, {
      client,
      model: env.OLLAMA_MODEL,
      semaphore,
      agentTimeoutMs: env.OLLAMA_AGENT_TIMEOUT_MS,
      coldStart,
      logger,
    }),
  );

  return app;
}

function isMainEntry(): boolean {
  if (typeof process === 'undefined') return false;
  if (process.env.VERCEL) return false;

  const entry = process.argv[1];
  if (!entry) return false;

  return entry.endsWith('server.ts') || entry.endsWith('server.js');
}

async function main(): Promise<void> {
  const env = loadConfig();
  const logger = createLogger(env.LOG_LEVEL);
  const registry = createArtifactRegistry();
  const client = createOllamaClient({
    host: env.OLLAMA_HOST,
    model: env.OLLAMA_MODEL,
    apiKey: env.OLLAMA_API_KEY,
    timeoutMs: env.OLLAMA_AGENT_TIMEOUT_MS,
  });

  try {
    await registry.reload();
  } catch (error) {
    logger.fatal({ err: error }, 'artifact load failed at boot');
    process.exit(1);
  }

  try {
    await client.checkModel();
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code === 'MODEL_MISSING') {
      logger.fatal(
        { model: env.OLLAMA_MODEL },
        `MODEL_MISSING: ${env.OLLAMA_MODEL} not found. Run 'npm run setup'.`,
      );
    } else if (code === 'OLLAMA_UNREACHABLE') {
      logger.fatal(
        { host: env.OLLAMA_HOST },
        'OLLAMA_UNREACHABLE: cannot reach Ollama. Is the server running?',
      );
    } else {
      logger.fatal({ err }, 'Ollama check failed at boot');
    }
    process.exit(1);
  }

  const app = createApp(env, registry);
  serve(
    { fetch: app.fetch, port: env.PORT },
    (info) => {
      logger.info(
        {
          port: info.port,
          ollamaHost: env.OLLAMA_HOST,
          ollamaModel: env.OLLAMA_MODEL,
          allowlist: env.CORS_ALLOWED_ORIGINS.split(','),
        },
        'chatbot-backend listening',
      );
    },
  );
}

const env = loadConfig();
const registry = createArtifactRegistry();

await registry.reload();

const app = createApp(env, registry);

export default handle(app);

if (isMainEntry()) {
  void main();
}
