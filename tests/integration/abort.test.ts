import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { requestIdMiddleware } from '../../src/observability/requestId.js';
import { buildChatRouter } from '../../src/chat/routes.js';
import type {
  PipelineResult,
  PipelineRunOptions,
} from '../../src/chat/dispatch.js';
import type {
  ArtifactRegistry,
  ArtifactRegistrySnapshot,
} from '../../src/loaders/registry.js';

interface AbortRecorder {
  /** Whether the override was even entered. */
  called: boolean;
  /** Monotonic ms timestamp at which the override's signal fired, or null. */
  abortedAt: number | null;
  /** The signal received by the override (kept for direct inspection). */
  signal: AbortSignal | null;
}

const EMPTY_SNAP: ArtifactRegistrySnapshot = {
  agents: [],
  skills: [],
  conducta: [],
};

function makeRegistry(): ArtifactRegistry {
  return {
    snapshot: () => EMPTY_SNAP,
    reload: async () => EMPTY_SNAP,
  };
}

function makeApp(recorder: AbortRecorder): Hono {
  const app = new Hono();
  app.use('*', requestIdMiddleware);
  app.route(
    '/',
    buildChatRouter(makeRegistry(), {
      client: {
        chatOnce: () => Promise.reject(new Error('not used')),
        chatStream: (() => {
          throw new Error('not used');
        }) as never,
        checkModel: () => Promise.resolve(),
      },
      semaphore: { acquire: () => Promise.resolve(), release: () => undefined } as never,
      agentTimeoutMs: 30_000,
      coldStart: {
        isCold: () => false,
        takeColdBudgetMs: () => null,
      } as never,
      pipelineOverride: async (args: PipelineRunOptions): Promise<PipelineResult> => {
        recorder.called = true;
        recorder.signal = args.signal;
        if (args.signal.aborted) {
          recorder.abortedAt = performance.now();
        } else {
          args.signal.addEventListener(
            'abort',
            () => {
              recorder.abortedAt = performance.now();
            },
            { once: true },
          );
        }
        return {
          events: (async function* (): AsyncGenerator<never, void, void> {
            // Block until the signal aborts, but bound by a long timeout
            // so a wiring bug cannot hang the test suite. While blocked,
            // the route's for-await is parked here, which is exactly the
            // shape the route sees during a real abort.
            const start = performance.now();
            while (
              !args.signal.aborted &&
              performance.now() - start < 2_000
            ) {
              await new Promise((r) => setTimeout(r, 5));
            }
            // Do not yield anything on purpose: the route should
            // short-circuit via stream.aborted / signal, not by reading
            // a sentinel done frame from us.
            return;
          })(),
        };
      },
    }),
  );
  return app;
}

describe('POST /chat abort propagation', () => {
  it('forwards the outer request signal to the pipeline within ≤200ms of abort (R8)', async () => {
    const recorder: AbortRecorder = {
      called: false,
      abortedAt: null,
      signal: null,
    };
    const app = makeApp(recorder);

    const ctl = new AbortController();
    const resPromise = app.request('http://test/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'hi' }],
        lang: 'en',
      }),
      // Hono's test app reads the Request's signal as `c.req.raw.signal`.
      signal: ctl.signal,
    });

    // Give the route a beat to enter the pipeline override.
    await new Promise((r) => setTimeout(r, 10));
    expect(recorder.called).toBe(true);
    expect(recorder.signal).not.toBeNull();
    expect(recorder.signal!.aborted).toBe(false);

    const t0 = performance.now();
    ctl.abort();
    // We do not await resPromise yet: we want to measure propagation
    // latency, not the full response close. But we DO need to drain the
    // stream so Hono's streamSSE releases the generator we are blocking.
    try {
      const r = await resPromise;
      await r.body?.cancel();
    } catch {
      // Hono may throw on abort; ignore. The signal is what matters.
    }

    expect(recorder.abortedAt).not.toBeNull();
    const propagationMs = (recorder.abortedAt as number) - t0;
    // Spec R8: abort propagation ≤200ms. We give the scheduler a tiny
    // margin to account for macrotask coalescing.
    expect(propagationMs).toBeLessThan(200);
    expect(recorder.signal!.aborted).toBe(true);
  });

  it('observes an already-aborted signal synchronously (R15 — no resumption)', async () => {
    const recorder: AbortRecorder = {
      called: false,
      abortedAt: null,
      signal: null,
    };
    const app = makeApp(recorder);

    const ctl = new AbortController();
    ctl.abort();
    const start = performance.now();
    const resPromise = app.request('http://test/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'hi' }],
        lang: 'en',
      }),
      signal: ctl.signal,
    });
    try {
      const r = await resPromise;
      await r.body?.cancel();
    } catch {
      // Hono may throw on abort; ignore. The signal is what matters.
    }

    expect(recorder.called).toBe(true);
    expect(recorder.abortedAt).not.toBeNull();
    // Pre-aborted signal: the override should observe abort immediately.
    expect((recorder.abortedAt as number) - start).toBeLessThan(200);
    expect(recorder.signal!.aborted).toBe(true);
  });
});
