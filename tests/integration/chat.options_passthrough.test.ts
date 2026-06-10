/**
 * Integration test: taxalia-options-json blocks in agent text MUST pass through
 * as SSE delta frames. The frontend strips them from visible markdown and
 * renders them as buttons; the backend must NOT strip them before yielding.
 */
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
import type { DeltaEvent, SSEEvent } from '../../src/chat/schemas.js';

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

const AGENT_TEXT_WITH_OPTIONS = `Income Tax covers personal, business, expat, and FBAR filings.

\`\`\`taxalia-options-json
{
  "options": [
    { "id": "personal", "label": "Personal Return", "message": "Tell me about personal income tax returns" },
    { "id": "business", "label": "Business Income Tax", "message": "Tell me about business income tax" },
    { "id": "expat", "label": "Expat / International", "message": "Tell me about expat tax services" },
    { "id": "fbar", "label": "FBAR Filing", "message": "Tell me about FBAR filings" }
  ]
}
\`\`\``;

describe('POST /chat — taxalia-options-json passthrough', () => {
  it('SSE deltas contain the options fenced block when agent emits one', async () => {
    const agents: AgentDef[] = [
      makeAgent('financial', 'Financial services'),
    ];
    const snap: ArtifactRegistrySnapshot = {
      agents,
      skills: [],
      conducta: makeConducta(),
    };
    const client = makeStubClient({
      orchestratorDecision: { agentsToRun: ['financial'], reasoning: 'income tax' },
      agentText: AGENT_TEXT_WITH_OPTIONS,
    });
    const registry = makeRegistry(snap);
    const app = makeAppWithRealPipeline(client, registry);

    const res = await app.request('http://test/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Tell me about your income tax services' }],
        lang: 'en',
      }),
    });

    expect(res.status).toBe(200);
    const frames = parseSse(await res.text());
    const combinedDelta = frames
      .filter((e): e is DeltaEvent => 'delta' in e)
      .map((e) => e.delta)
      .join('');

    // The options fenced block MUST be present in the streamed output so the
    // frontend can parse and render the category buttons.
    expect(combinedDelta).toContain('```taxalia-options-json');
    expect(combinedDelta).toContain('"id": "personal"');
  });
});
