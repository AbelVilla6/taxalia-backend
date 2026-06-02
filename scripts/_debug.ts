import { Hono } from 'hono';
import { requestIdMiddleware } from '../src/observability/requestId.js';
import { buildChatRouter } from '../src/chat/routes.js';
import { runChatPipeline } from '../src/chat/dispatch.js';
import { ColdStartGate } from '../src/chat/coldStart.js';
import { Semaphore } from '../src/dispatch/semaphore.js';
import type { AgentDef } from '../src/agents/loader.js';
import type { OllamaChatRequest, OllamaChatResponse, OllamaChatStreamRequest, OllamaClient } from '../src/ollama/interface.js';
import type { ArtifactRegistry } from '../src/loaders/registry.js';

async function main() {
  const agents: AgentDef[] = [
    { id: 'valuation', name: 'v', description: 'v', systemPrompt: 'v', system_prompt: 'v', tools: [], tags: [], body: '', filePath: 'v.md' },
  ];
  const registry: ArtifactRegistry = { snapshot: () => ({ agents, skills: [], conducta: [] }), reload: async () => ({ agents, skills: [], conducta: [] }) };

  const client: OllamaClient = {
    chatOnce: async (_req: OllamaChatRequest): Promise<OllamaChatResponse> => {
      console.log('[stub] chatOnce called');
      return { content: JSON.stringify({ agentsToRun: ['valuation'], reasoning: 'yes' }) };
    },
    chatStream: (_req: OllamaChatStreamRequest): AsyncIterable<string> => {
      console.log('[stub] chatStream called');
      async function* gen() { yield 'STREAM_TEXT_HERE'; }
      return gen();
    },
    checkModel: async () => undefined,
  };

  const app = new Hono();
  app.use('*', requestIdMiddleware);
  app.route('/', buildChatRouter(registry, {
    client,
    semaphore: new Semaphore(2),
    agentTimeoutMs: 30000,
    coldStart: new ColdStartGate(0),
    pipelineOverride: (args) => runChatPipeline({
      ...args, client, semaphore: new Semaphore(2), agentTimeoutMs: 30000, coldStart: new ColdStartGate(0), registry,
    }),
  }));

  const res = await app.request('http://test/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Necesito valoración' }], lang: 'es' }),
  });
  console.log('STATUS', res.status);
  const body = await res.text();
  console.log('BODY', body);
}
main();
