import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { requestIdMiddleware } from '../../src/observability/requestId.js';
import { buildChatRouter } from '../../src/chat/routes.js';
import { ColdStartGate } from '../../src/chat/coldStart.js';
import { Semaphore } from '../../src/dispatch/semaphore.js';
import type { ArtifactRegistry, ArtifactRegistrySnapshot } from '../../src/loaders/registry.js';
import type { AgentDef } from '../../src/agents/loader.js';
import type { OllamaClient } from '../../src/ollama/interface.js';

function makeAgent(id: string): AgentDef {
  return {
    id,
    name: id,
    description: `${id} desc`,
    systemPrompt: `system ${id}`,
    system_prompt: `system ${id}`,
    tools: [],
    tags: [],
    body: '',
    filePath: `${id}.md`,
  };
}

function makeRegistry(snap: ArtifactRegistrySnapshot): ArtifactRegistry {
  return {
    snapshot: () => snap,
    reload: async () => snap,
  };
}

function makeUnreachableClient(): OllamaClient {
  // Simulates Ollama refusing the connection on :11434. The error is the
  // exact shape produced by `wrapOllamaError(new Error('ECONNREFUSED…'))`,
  // so the orchestrator's `isOllamaUnreachable` predicate MUST match.
  const err: Error & { code: string } = Object.assign(
    new Error('connect ECONNREFUSED 127.0.0.1:11434'),
    { code: 'OLLAMA_UNREACHABLE' },
  );
  return {
    chatOnce: () => Promise.reject(err),
    chatStream: (() => {
      throw err;
    }) as never,
    checkModel: () => Promise.reject(err),
  };
}

function makeApp(): Hono {
  const app = new Hono();
  app.use('*', requestIdMiddleware);
  const registry = makeRegistry({
    agents: [makeAgent('advisory'), makeAgent('valuation')],
    skills: [],
    conducta: [],
  });
  app.route(
    '/',
    buildChatRouter(registry, {
      client: makeUnreachableClient(),
      semaphore: new Semaphore(2),
      agentTimeoutMs: 30_000,
      coldStart: new ColdStartGate(0),
    }),
  );
  return app;
}

interface ErrorBody {
  error: { code: string; message: string; requestId: string };
}

async function readError(res: Response): Promise<ErrorBody> {
  return (await res.json()) as ErrorBody;
}

describe('POST /chat when Ollama is unreachable (pre-stream failure)', () => {
  it('returns 503 OLLAMA_UNREACHABLE without opening an SSE stream', async () => {
    const app = makeApp();
    const res = await app.request('http://test/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-Id': 'req-unreach-1',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'help me with taxes' }],
        lang: 'en',
      }),
    });

    expect(res.status).toBe(503);
    // The route must NOT open a text/event-stream on a pre-stream error.
    expect(res.headers.get('content-type') ?? '').not.toMatch(/text\/event-stream/);
    expect(res.headers.get('x-request-id')).toBe('req-unreach-1');

    const body = await readError(res);
    expect(body.error.code).toBe('OLLAMA_UNREACHABLE');
    expect(body.error.requestId).toBe('req-unreach-1');
    expect(body.error.message).toBeTruthy();
  });

  it('does not emit any SSE frames for the unreachable case (no body trickery)', async () => {
    const app = makeApp();
    const res = await app.request('http://test/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'help' }],
        lang: 'en',
      }),
    });
    expect(res.status).toBe(503);
    const text = await res.text();
    // A well-formed SSE stream would start with `data:`. The error
    // envelope is plain JSON, so we MUST NOT see SSE framing.
    expect(text.startsWith('data:')).toBe(false);
    expect(text).not.toMatch(/\nevent:/);
    // Body should be the JSON error envelope and nothing else.
    const parsed = JSON.parse(text) as ErrorBody;
    expect(parsed.error.code).toBe('OLLAMA_UNREACHABLE');
  });

  it('propagates MODEL_MISSING (404 from /api/show during the orchestrator call) as 503', async () => {
    const missing: Error & { code: string } = Object.assign(
      new Error("model 'gemma4:e4b' not found, status 404"),
      { code: 'MODEL_MISSING' },
    );
    const registry = makeRegistry({
      agents: [makeAgent('advisory')],
      skills: [],
      conducta: [],
    });
    const app = new Hono();
    app.use('*', requestIdMiddleware);
    app.route(
      '/',
      buildChatRouter(registry, {
        client: {
          chatOnce: () => Promise.reject(missing),
          chatStream: (() => {
            throw missing;
          }) as never,
          checkModel: () => Promise.reject(missing),
        } satisfies OllamaClient,
        semaphore: new Semaphore(2),
        agentTimeoutMs: 30_000,
        coldStart: new ColdStartGate(0),
      }),
    );

    const res = await app.request('http://test/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'help' }],
        lang: 'en',
      }),
    });
    expect(res.status).toBe(503);
    const body = await readError(res);
    expect(body.error.code).toBe('MODEL_MISSING');
    // R10 spec: error message must name `npm run setup` so the operator
    // knows the recovery path without reading docs.
    expect(body.error.message.toLowerCase()).toContain('npm run setup');
  });
});
