import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { requestIdMiddleware } from '../../src/observability/requestId.js';
import { buildChatRouter } from '../../src/chat/routes.js';

// Ollama is NOT touched in this test. The route must short-circuit before any
// network I/O. Mock the module so any accidental import fails the test loudly.
vi.mock('ollama', () => {
  throw new Error('Ollama client must not be imported by /health.');
});

function makeApp(): Hono {
  const app = new Hono();
  app.use('*', requestIdMiddleware);
  app.route('/', buildChatRouter());
  return app;
}

describe('GET /health', () => {
  it('returns 200 with model name within 100ms', async () => {
    const app = makeApp();
    const start = performance.now();
    const res = await app.request('http://test/health');
    const elapsed = performance.now() - start;
    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(100);
    const body = (await res.json()) as { ok: boolean; model: string };
    expect(body).toEqual({ ok: true, model: 'gemma4:e4b' });
  });

  it('generates an X-Request-Id when the client omits it', async () => {
    const app = makeApp();
    const res = await app.request('http://test/health');
    const id = res.headers.get('X-Request-Id');
    expect(id).toBeTruthy();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('echoes a client-supplied X-Request-Id', async () => {
    const app = makeApp();
    const res = await app.request('http://test/health', {
      headers: { 'X-Request-Id': 'client-supplied-1' },
    });
    expect(res.headers.get('X-Request-Id')).toBe('client-supplied-1');
  });
});
