import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { requestIdMiddleware } from '../../src/observability/requestId.js';
import { buildChatRouter } from '../../src/chat/routes.js';
import type { Env } from '../../src/config.js';

const ENV: Env = {
  OLLAMA_HOST: 'http://127.0.0.1:11434',
  PORT: 4324,
  OLLAMA_AGENT_TIMEOUT_MS: 30_000,
  CORS_ALLOWED_ORIGINS: 'http://localhost:4321,http://localhost:4322',
  LOG_LEVEL: 'silent',
  DISPATCH_CONCURRENCY_CAP: 2,
};

const ALLOWLIST = ENV.CORS_ALLOWED_ORIGINS.split(',');

function makeApp(): Hono {
  const app = new Hono();
  app.use('*', requestIdMiddleware);
  app.use(
    '*',
    cors({
      origin: ALLOWLIST,
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Accept', 'X-Request-Id'],
      credentials: false,
    }),
  );
  app.route('/', buildChatRouter());
  return app;
}

interface ErrorBody {
  error: { code: string; message: string; requestId: string };
}

async function readError(res: Response): Promise<ErrorBody> {
  return (await res.json()) as ErrorBody;
}

describe('POST /chat error envelope', () => {
  it('rejects unsupported lang with 400 + UNSUPPORTED_LANG', async () => {
    const app = makeApp();
    const res = await app.request('http://test/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'hi' }],
        lang: 'fr',
      }),
    });
    expect(res.status).toBe(400);
    const body = await readError(res);
    expect(body.error.code).toBe('UNSUPPORTED_LANG');
    expect(body.error.requestId).toBeTruthy();
  });

  it('rejects missing lang with 400 + UNSUPPORTED_LANG', async () => {
    const app = makeApp();
    const res = await app.request('http://test/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    expect(res.status).toBe(400);
    const body = await readError(res);
    expect(body.error.code).toBe('UNSUPPORTED_LANG');
  });

  it('rejects empty last user message with 400 + EMPTY_MESSAGE', async () => {
    const app = makeApp();
    const res = await app.request('http://test/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: '' }],
        lang: 'en',
      }),
    });
    expect(res.status).toBe(400);
    const body = await readError(res);
    expect(body.error.code).toBe('EMPTY_MESSAGE');
  });

  it('rejects whitespace-only last user message with 400 + EMPTY_MESSAGE', async () => {
    const app = makeApp();
    const res = await app.request('http://test/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'assistant', content: 'welcome' },
          { role: 'user', content: '   \n\t  ' },
        ],
        lang: 'en',
      }),
    });
    expect(res.status).toBe(400);
    const body = await readError(res);
    expect(body.error.code).toBe('EMPTY_MESSAGE');
  });

  it('rejects malformed JSON body with 400 + BAD_REQUEST', async () => {
    const app = makeApp();
    const res = await app.request('http://test/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    });
    expect(res.status).toBe(400);
    const body = await readError(res);
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  it('rejects shape-invalid body with 400 + BAD_REQUEST', async () => {
    const app = makeApp();
    const res = await app.request('http://test/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: 'not-an-array', lang: 'en' }),
    });
    expect(res.status).toBe(400);
    const body = await readError(res);
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  it('echoes the client X-Request-Id in the error envelope', async () => {
    const app = makeApp();
    const res = await app.request('http://test/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-Id': 'req-abc-123',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: '' }],
        lang: 'en',
      }),
    });
    expect(res.status).toBe(400);
    const body = await readError(res);
    expect(body.error.requestId).toBe('req-abc-123');
    expect(res.headers.get('X-Request-Id')).toBe('req-abc-123');
  });
});
