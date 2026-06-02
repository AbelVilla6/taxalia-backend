import { serve } from '@hono/node-server';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import { loadConfig, type Env } from './config.js';
import { buildChatRouter } from './chat/routes.js';
import { createArtifactRegistry } from './loaders/registry.js';
import { createLogger } from './observability/logger.js';
import { requestIdMiddleware } from './observability/requestId.js';
import { createOllamaClient } from './ollama/client.js';
import { Semaphore } from './dispatch/semaphore.js';
import { ColdStartGate } from './chat/coldStart.js';

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

export function createApp(env: Env, registry = createArtifactRegistry()): Hono {
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

  const client = createOllamaClient({
    host: env.OLLAMA_HOST,
    timeoutMs: env.OLLAMA_AGENT_TIMEOUT_MS,
  });
  const semaphore = new Semaphore(env.DISPATCH_CONCURRENCY_CAP);
  const coldStart = new ColdStartGate(60_000);

  app.route(
    '/',
    buildChatRouter(registry, {
      client,
      semaphore,
      agentTimeoutMs: env.OLLAMA_AGENT_TIMEOUT_MS,
      coldStart,
    }),
  );

  return app;
}

function isMainEntry(): boolean {
  if (typeof process === 'undefined') return false;
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
        { model: 'gemma4:e4b' },
        "MODEL_MISSING: gemma4:e4b not found. Run 'npm run setup'.",
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
          allowlist: env.CORS_ALLOWED_ORIGINS.split(','),
        },
        'chatbot-backend listening',
      );
    },
  );
}

if (isMainEntry()) {
  void main();
}
