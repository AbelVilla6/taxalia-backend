import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { requestIdMiddleware } from '../../src/observability/requestId.js';
import { buildChatRouter } from '../../src/chat/routes.js';
import { runChatPipeline, type PipelineRunOptions } from '../../src/chat/dispatch.js';
import { ColdStartGate } from '../../src/chat/coldStart.js';
import { Semaphore } from '../../src/dispatch/semaphore.js';
import type {
  ArtifactRegistry,
  ArtifactRegistrySnapshot,
} from '../../src/loaders/registry.js';
import type { AgentDef } from '../../src/agents/loader.js';
import type { ConductDef } from '../../src/conducta/loader.js';
import type {
  OllamaChatRequest,
  OllamaChatResponse,
  OllamaChatStreamRequest,
  OllamaClient,
} from '../../src/ollama/interface.js';
import type {
  DeltaEvent,
  DoneEnvelope,
  SSEEvent,
} from '../../src/chat/schemas.js';

function makeAgent(id: string, description: string): AgentDef {
  return {
    id,
    name: id,
    description,
    systemPrompt: `system ${id}`,
    system_prompt: `system ${id}`,
    tools: [],
    tags: [],
    body: '',
    filePath: `${id}.md`,
  };
}

function makeConducta(): ConductDef[] {
  return Array.from({ length: 5 }, (_, i) => ({
    id: `policy-${i + 1}`,
    description: `Policy ${i + 1}`,
    rule: `Rule ${i + 1}`,
    priority: i + 1,
    body: '',
    filePath: `policy-${i + 1}.md`,
  }));
}

function makeRegistry(snap: ArtifactRegistrySnapshot): ArtifactRegistry {
  return {
    snapshot: () => snap,
    reload: async () => snap,
  };
}

function makeFullSnapshot(agents: AgentDef[]): ArtifactRegistrySnapshot {
  return { agents, skills: [], conducta: makeConducta() };
}

const AGENTS: AgentDef[] = [
  makeAgent('advisory', 'Advisory services'),
  makeAgent('valuation', 'Valuation services'),
  makeAgent('financial', 'Financial services'),
];

/**
 * Build a stub Ollama client that:
 * - returns the configured orchestrator decision for chatOnce (used by
 *   the orchestrator), and
 * - yields a simple stream chunk for chatStream (used by the agents).
 *
 * This drives the REAL `runChatPipeline` end-to-end without requiring
 * a live Ollama server.
 */
function makeStubClient(opts: {
  orchestratorDecision: { agentsToRun: string[]; reasoning: string };
  agentText: string;
}): OllamaClient {
  return {
    chatOnce: async (_req: OllamaChatRequest): Promise<OllamaChatResponse> => {
      return { content: JSON.stringify(opts.orchestratorDecision) };
    },
    chatStream: (_req: OllamaChatStreamRequest): AsyncIterable<string> => {
      async function* gen(): AsyncGenerator<string, void, void> {
        yield opts.agentText;
      }
      return gen();
    },
    checkModel: async () => undefined,
  };
}

function makeAppWithRealPipeline(
  client: OllamaClient,
  registry: ArtifactRegistry,
): Hono {
  const app = new Hono();
  app.use('*', requestIdMiddleware);
  app.route(
    '/',
    buildChatRouter(registry, {
      client,
      semaphore: new Semaphore(2),
      agentTimeoutMs: 30_000,
      coldStart: new ColdStartGate(0),
      pipelineOverride: (args: PipelineRunOptions) =>
        runChatPipeline({
          ...args,
          client,
          semaphore: new Semaphore(2),
          agentTimeoutMs: 30_000,
          coldStart: new ColdStartGate(0),
          registry,
        }),
    }),
  );
  return app;
}

function parseSse(body: string): SSEEvent[] {
  const out: SSEEvent[] = [];
  for (const raw of body.split('\n\n')) {
    const line = raw.trim();
    if (!line || !line.startsWith('data:')) continue;
    const payload = line.slice('data:'.length).trim();
    out.push(JSON.parse(payload) as SSEEvent);
  }
  return out;
}

describe('POST /chat — business prompt visibility (no empty done regression)', () => {
  it('routes a Spanish valuation prompt to the valuation agent and emits visible text', async () => {
    const client = makeStubClient({
      orchestratorDecision: { agentsToRun: ['valuation'], reasoning: 'valoraci\u00f3n' },
      agentText: 'Le explico c\u00f3mo valoramos su empresa...',
    });
    const registry = makeRegistry(makeFullSnapshot(AGENTS));
    const app = makeAppWithRealPipeline(client, registry);

    const res = await app.request('http://test/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-Id': 'req-vis-1',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Necesito un an\u00e1lisis de valoraci\u00f3n de mi empresa' }],
        lang: 'es',
      }),
    });

    expect(res.status).toBe(200);
    const frames = parseSse(await res.text());
    const text = frames
      .filter((e): e is DeltaEvent => 'delta' in e)
      .map((e) => e.delta)
      .join('');
    expect(text).toContain('valoramos');

    const last = frames[frames.length - 1] as DoneEnvelope;
    expect(last.done).toBe(true);
    expect(last.agents).toHaveLength(1);
    expect(last.agents[0]?.id).toBe('valuation');
  });

  it('emits a visible Spanish warning when the LLM returns [] AND the keyword fallback finds nothing', async () => {
    // A truly ambiguous prompt with no business keywords: must NOT
    // produce an empty `done` with no text. The user must see the
    // localized fallback warning in the chat widget.
    const client = makeStubClient({
      orchestratorDecision: { agentsToRun: [], reasoning: '' },
      agentText: 'unused',
    });
    const registry = makeRegistry(makeFullSnapshot(AGENTS));
    const app = makeAppWithRealPipeline(client, registry);

    const res = await app.request('http://test/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'mmm' }],
        lang: 'es',
      }),
    });
    expect(res.status).toBe(200);
    const frames = parseSse(await res.text());

    const text = frames
      .filter((e): e is DeltaEvent => 'delta' in e)
      .map((e) => e.delta)
      .join('');
    expect(text.length).toBeGreaterThan(0);
    expect(text).toMatch(/Taxalia|asesor|valoraci|financier/i);

    const last = frames[frames.length - 1] as DoneEnvelope;
    expect(last.done).toBe(true);
    expect(last.warning).toBeTruthy();
    expect(last.warning).toMatch(/Taxalia|asesor|valoraci|financier/i);
  });

  it('emits a visible English warning when the LLM returns [] AND the keyword fallback finds nothing', async () => {
    const client = makeStubClient({
      orchestratorDecision: { agentsToRun: [], reasoning: '' },
      agentText: 'unused',
    });
    const registry = makeRegistry(makeFullSnapshot(AGENTS));
    const app = makeAppWithRealPipeline(client, registry);

    const res = await app.request('http://test/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'hmm' }],
        lang: 'en',
      }),
    });
    expect(res.status).toBe(200);
    const frames = parseSse(await res.text());

    const text = frames
      .filter((e): e is DeltaEvent => 'delta' in e)
      .map((e) => e.delta)
      .join('');
    expect(text.length).toBeGreaterThan(0);
    expect(text).toMatch(/Taxalia|advisory|valuation|financial/i);

    const last = frames[frames.length - 1] as DoneEnvelope;
    expect(last.warning).toBeTruthy();
  });

  it('keyword fallback routes a Spanish business prompt to an agent when the LLM returns []', async () => {
    // The LLM under-routes (returns []), but the keyword fallback MUST
    // rescue this and select the valuation agent so the user gets a
    // real answer instead of the no-agents warning.
    const client = makeStubClient({
      orchestratorDecision: { agentsToRun: [], reasoning: '' },
      agentText: 'An\u00e1lisis de valoraci\u00f3n...',
    });
    const registry = makeRegistry(makeFullSnapshot(AGENTS));
    const app = makeAppWithRealPipeline(client, registry);

    const res = await app.request('http://test/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'user', content: 'Necesito un an\u00e1lisis de valoraci\u00f3n de mi empresa' },
        ],
        lang: 'es',
      }),
    });
    expect(res.status).toBe(200);
    const frames = parseSse(await res.text());

    const text = frames
      .filter((e): e is DeltaEvent => 'delta' in e)
      .map((e) => e.delta)
      .join('');
    expect(text).toContain('valoraci\u00f3n');

    const last = frames[frames.length - 1] as DoneEnvelope;
    expect(last.done).toBe(true);
    expect(last.agents.map((a) => a.id)).toContain('valuation');
  });
});
