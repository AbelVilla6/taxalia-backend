import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { handle } from '@hono/node-server/vercel';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import { loadConfig, type Env } from './config.js';
import { buildContactRouter } from './contact/routes.js';
import { createContactSender } from './contact/mail.js';
import { buildChatRouter } from './chat/routes.js';
import { createArtifactRegistry } from './loaders/registry.js';
import { openBlogDb } from './content/db.js';
import { PostRepository } from './content/repository.js';
import { buildContentRouter } from './content/routes.js';
import { seedIfEmpty } from './content/seed.js';
import { AuthService } from './admin/auth.js';
import { buildAdminRouter } from './admin/routes.js';
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

    // Same-origin requests (e.g. the backend-served /admin panel calling
    // /api/admin) are always allowed regardless of the frontend allowlist.
    const selfOrigin = new URL(c.req.url).origin;

    if (origin && origin !== selfOrigin && !allowlist.includes(origin)) {
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
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
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
  const sendContactSubmission = createContactSender(env);
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
      bookingUrl: env.CALCOM_URL,
      logger,
    }),
  );
  app.route(
    '/',
    buildContactRouter({
      sendSubmission: sendContactSubmission,
      logger,
    }),
  );

  // Blog content store + public read API (/api/posts). Guarded so a missing or
  // read-only filesystem (e.g. serverless) disables the blog API without
  // taking down the chat backend.
  try {
    const db = openBlogDb(env.BLOG_DB_PATH);
    const repo = new PostRepository(db, env.FRONTEND_SITE_URL);
    const seeded = seedIfEmpty(repo);
    logger.info(
      { dbPath: env.BLOG_DB_PATH, seeded },
      'blog content store ready',
    );

    // Public read API.
    app.route('/api', buildContentRouter(repo));

    // Admin: auth + write API + media, plus the panel UI it serves.
    const auth = new AuthService(db, env.SESSION_TTL_HOURS * 3_600_000);
    auth.ensureAdminUser(env.ADMIN_USERNAME, env.ADMIN_PASSWORD);
    if (
      process.env.NODE_ENV === 'production' &&
      env.ADMIN_PASSWORD === 'change-me-now'
    ) {
      logger.warn('ADMIN_PASSWORD is the default value in production. Set a strong ADMIN_PASSWORD.');
    }

    app.route(
      '/api/admin',
      buildAdminRouter({
        repo,
        auth,
        uploadDir: env.UPLOAD_DIR,
        sessionTtlMs: env.SESSION_TTL_HOURS * 3_600_000,
        cookieSecure: process.env.NODE_ENV === 'production',
      }),
    );

    // Ensure the uploads dir exists so static serving doesn't warn on a fresh
    // host before the first upload.
    mkdirSync(resolve(env.UPLOAD_DIR), { recursive: true });

    // Admin panel (static SPA + assets) + uploaded media.
    app.get('/admin', serveStatic({ path: './src/admin/public/index.html' }));
    app.use(
      '/admin/*',
      serveStatic({
        root: './src/admin/public',
        rewriteRequestPath: (p) => p.replace(/^\/admin/, ''),
      }),
    );
    app.use(
      '/uploads/*',
      serveStatic({
        root: env.UPLOAD_DIR,
        rewriteRequestPath: (p) => p.replace(/^\/uploads/, ''),
      }),
    );
  } catch (err) {
    logger.error({ err }, 'blog content store unavailable; /api disabled');
  }

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

  if (env.SKIP_OLLAMA_CHECK) {
    logger.warn(
      'SKIP_OLLAMA_CHECK is set: starting without Ollama. Chat will fail until Ollama is reachable; blog API is unaffected.',
    );
  }

  try {
    if (!env.SKIP_OLLAMA_CHECK) await client.checkModel();
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
