import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { requestIdMiddleware } from '../../src/observability/requestId.js';
import { buildChatRouter } from '../../src/chat/routes.js';
import { ColdStartGate } from '../../src/chat/coldStart.js';
import { Semaphore } from '../../src/dispatch/semaphore.js';
import { createOllamaClient } from '../../src/ollama/client.js';
import { createArtifactRegistry } from '../../src/loaders/registry.js';
import { resetMetrics } from '../../src/observability/metrics.js';

/**
 * Cold-start fixture: first SSE event must arrive within 60s for a valid
 * chat request against a real, freshly-served Ollama instance.
 *
 * Gated behind `RUN_LIVE_OLLAMA_TESTS=1` so the regular `npm test` does
 * NOT need a running model. This is a guard test: it documents the 60s
 * cold-start budget (chat-endpoint spec edge case) but does not enforce
 * it on every run.
 */
const LIVE = process.env.RUN_LIVE_OLLAMA_TESTS === '1';

describe.skipIf(!LIVE)('POST /chat cold-start fixture (live Ollama)', () => {
  it('first SSE event arrives within 60s when the model is freshly loaded', async () => {
    resetMetrics();
    const env = {
      OLLAMA_HOST: process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434',
      PORT: 0,
      OLLAMA_AGENT_TIMEOUT_MS: 30_000,
      CORS_ALLOWED_ORIGINS: 'http://localhost:4321,http://localhost:4322',
      LOG_LEVEL: 'silent',
      DISPATCH_CONCURRENCY_CAP: 2,
    };
    const registry = createArtifactRegistry();
    await registry.reload();
    const app = new Hono();
    app.use('*', requestIdMiddleware);
    app.route(
      '/',
      buildChatRouter(registry, {
        client: createOllamaClient({
          host: env.OLLAMA_HOST,
          timeoutMs: env.OLLAMA_AGENT_TIMEOUT_MS,
        }),
        semaphore: new Semaphore(env.DISPATCH_CONCURRENCY_CAP),
        agentTimeoutMs: env.OLLAMA_AGENT_TIMEOUT_MS,
        coldStart: new ColdStartGate(60_000),
      }),
    );

    const start = performance.now();
    const res = await app.request('http://test/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'hola, qué hacen?' }],
        lang: 'es',
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/event-stream/);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let firstEventAt: number | null = null;
    let doneSeen = false;
    const budgetMs = 60_000;

    while (!doneSeen) {
      const remaining = budgetMs - (performance.now() - start);
      if (remaining <= 0) {
        throw new Error(`Cold-start budget (${budgetMs}ms) exceeded before done.`);
      }
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';
      for (const ev of events) {
        const line = ev.trim();
        if (!line.startsWith('data:')) continue;
        if (firstEventAt === null) firstEventAt = performance.now();
        const payload = JSON.parse(line.slice('data:'.length).trim()) as {
          done?: boolean;
          delta?: string;
        };
        if (payload.done) {
          doneSeen = true;
          break;
        }
      }
    }

    expect(firstEventAt).not.toBeNull();
    expect((firstEventAt as number) - start).toBeLessThan(budgetMs);
  }, 70_000);
});
