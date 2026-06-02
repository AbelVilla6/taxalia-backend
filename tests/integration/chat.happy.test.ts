import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { requestIdMiddleware } from '../../src/observability/requestId.js';
import { buildChatRouter } from '../../src/chat/routes.js';
import type {
  AgentResult,
  DoneEnvelope,
  DeltaEvent,
  SSEEvent,
} from '../../src/chat/schemas.js';
import type {
  PipelineResult,
  PipelineRunOptions,
} from '../../src/chat/dispatch.js';
import type {
  ArtifactRegistry,
  ArtifactRegistrySnapshot,
} from '../../src/loaders/registry.js';

function makeAgentResult(): AgentResult[] {
  return [
    { id: 'advisory', status: 'ok', text: 'Advisory text', durationMs: 12 },
    { id: 'valuation', status: 'ok', text: 'Valuation text', durationMs: 18 },
  ];
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

function makeApp(opts: {
  pipelineOverride: (args: PipelineRunOptions) => Promise<PipelineResult>;
}): Hono {
  const app = new Hono();
  app.use('*', requestIdMiddleware);
  // The route guards on both `deps` and `registry`; when `pipelineOverride`
  // is set the registry is never read, but we still need to pass a stub
  // so the route reaches the SSE path instead of returning 501.
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
      pipelineOverride: opts.pipelineOverride,
    }),
  );
  return app;
}

interface ParsedFrame {
  event: SSEEvent;
}

function parseSse(body: string): ParsedFrame[] {
  const out: ParsedFrame[] = [];
  for (const raw of body.split('\n\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (!line.startsWith('data:')) continue;
    const payload = line.slice('data:'.length).trim();
    out.push({ event: JSON.parse(payload) as SSEEvent });
  }
  return out;
}

describe('POST /chat happy path (SSE)', () => {
  it('opens SSE, emits at least one delta, and terminates with done carrying agents and requestId', async () => {
    const seenRequestIds: string[] = [];
    const app = makeApp({
      pipelineOverride: async (args): Promise<PipelineResult> => {
        seenRequestIds.push(args.requestId);
        return {
          events: (async function* (): AsyncGenerator<SSEEvent, void, void> {
            const delta1: DeltaEvent = { delta: 'Hello ' };
            const delta2: DeltaEvent = { delta: 'world.' };
            yield delta1;
            yield delta2;
            const done: DoneEnvelope = {
              done: true,
              agents: makeAgentResult(),
              requestId: args.requestId,
            };
            yield done;
          })(),
        };
      },
    });

    const res = await app.request('http://test/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-Id': 'req-happy-1',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'help me with taxes' }],
        lang: 'en',
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/event-stream/);
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(res.headers.get('connection')).toBe('keep-alive');
    expect(res.headers.get('x-accel-buffering')).toBe('no');
    expect(res.headers.get('x-request-id')).toBe('req-happy-1');

    const body = await res.text();
    const frames = parseSse(body);
    const deltas = frames
      .map((f) => f.event)
      .filter((e): e is DeltaEvent => 'delta' in e)
      .map((e) => e.delta);
    expect(deltas.length).toBeGreaterThanOrEqual(1);
    expect(deltas.join('')).toBe('Hello world.');

    const last = frames[frames.length - 1].event;
    if (!('done' in last) || !last.done) {
      throw new Error('Expected terminal done frame');
    }
    const doneEvent = last as DoneEnvelope;
    expect(doneEvent.done).toBe(true);
    expect(doneEvent.requestId).toBe('req-happy-1');
    expect(doneEvent.agents).toHaveLength(2);
    expect(doneEvent.agents.map((a) => a.id).sort()).toEqual(['advisory', 'valuation']);

    expect(seenRequestIds).toEqual(['req-happy-1']);
  });

  it('echoes a client-supplied X-Request-Id in headers and the SSE done frame', async () => {
    const app = makeApp({
      pipelineOverride: async (args): Promise<PipelineResult> => {
        return {
          events: (async function* (): AsyncGenerator<SSEEvent, void, void> {
            yield { delta: 'hi' };
            yield {
              done: true,
              agents: [{ id: 'advisory', status: 'ok', text: 'hi', durationMs: 1 }],
              requestId: args.requestId,
            };
          })(),
        };
      },
    });

    const res = await app.request('http://test/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-Id': 'client-abc',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'hi' }],
        lang: 'en',
      }),
    });
    expect(res.headers.get('x-request-id')).toBe('client-abc');
    const frames = parseSse(await res.text());
    const last = frames[frames.length - 1].event as DoneEnvelope;
    expect(last.requestId).toBe('client-abc');
  });

  it('generates a UUID v4 X-Request-Id when the client omits it', async () => {
    const app = makeApp({
      pipelineOverride: async (args): Promise<PipelineResult> => {
        return {
          events: (async function* (): AsyncGenerator<SSEEvent, void, void> {
            yield { delta: 'x' };
            yield {
              done: true,
              agents: [],
              requestId: args.requestId,
            };
          })(),
        };
      },
    });

    const res = await app.request('http://test/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'hi' }],
        lang: 'en',
      }),
    });
    const id = res.headers.get('x-request-id') ?? '';
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('serves a Spanish request through the Spanish locale (es) without code-level branching bugs', async () => {
    const app = makeApp({
      pipelineOverride: async (args): Promise<PipelineResult> => {
        return {
          events: (async function* (): AsyncGenerator<SSEEvent, void, void> {
            yield { delta: 'Hola ' };
            yield { delta: 'mundo' };
            yield {
              done: true,
              agents: [
                { id: 'advisory', status: 'ok', text: 'Hola mundo', durationMs: 5 },
              ],
              requestId: args.requestId,
            };
          })(),
        };
      },
    });

    const res = await app.request('http://test/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'hola' }],
        lang: 'es',
      }),
    });
    expect(res.status).toBe(200);
    const frames = parseSse(await res.text());
    const text = frames
      .map((f) => f.event)
      .filter((e): e is DeltaEvent => 'delta' in e)
      .map((e) => e.delta)
      .join('');
    expect(text).toBe('Hola mundo');
  });
});
