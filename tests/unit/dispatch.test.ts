import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runChatPipeline, type PipelineRunOptions } from '../../src/chat/dispatch.js';
import { PipelineError } from '../../src/chat/errors.js';
import { ColdStartGate } from '../../src/chat/coldStart.js';
import { Semaphore } from '../../src/dispatch/semaphore.js';
import { resetMetrics } from '../../src/observability/metrics.js';
import type {
  OllamaChatRequest,
  OllamaChatResponse,
  OllamaChatStreamRequest,
  OllamaClient,
} from '../../src/ollama/interface.js';
import type { ArtifactRegistry, ArtifactRegistrySnapshot } from '../../src/loaders/registry.js';
import type { AgentDef } from '../../src/agents/loader.js';

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

function makeSnapshot(agents: AgentDef[]): ArtifactRegistrySnapshot {
  return { agents, skills: [], conducta: [] };
}

function makeRegistry(snap: ArtifactRegistrySnapshot): ArtifactRegistry {
  return {
    snapshot: () => snap,
    reload: async () => snap,
  };
}

function makeClient(opts: {
  chatOnce?: (req: OllamaChatRequest) => Promise<OllamaChatResponse> | OllamaChatResponse;
  chatStream?: (req: OllamaChatStreamRequest) => AsyncIterable<string>;
}): OllamaClient {
  return {
    chatOnce: vi.fn(async (req) => {
      if (!opts.chatOnce) throw new Error('chatOnce not configured for this test');
      return opts.chatOnce(req);
    }),
    chatStream: opts.chatStream
      ? (req) => opts.chatStream!(req)
      : (_req: OllamaChatStreamRequest) => {
          throw new Error('chatStream not configured for this test');
        },
    checkModel: vi.fn(async () => undefined),
  };
}

function makeOpts(args: {
  client: OllamaClient;
  registry: ArtifactRegistry;
}): PipelineRunOptions {
  return {
    request: {
      messages: [{ role: 'user', content: 'help me with taxes' }],
      lang: 'en',
    },
    requestId: 'req-pipeline',
    signal: new AbortController().signal,
    client: args.client,
    semaphore: new Semaphore(2),
    agentTimeoutMs: 1000,
    coldStart: new ColdStartGate(0),
    registry: args.registry,
  };
}

describe('runChatPipeline (preflight contract)', () => {
  beforeEach(() => {
    resetMetrics();
  });

  // PR4-B Defect A: errors that arise BEFORE the SSE stream opens
  // (validation, orchestrator, runAgents) MUST be thrown synchronously
  // from `runChatPipeline` so the route can map them to HTTP 400/500/503
  // before opening the SSE connection. The previous implementation
  // returned an un-started generator, which meant the route's try/catch
  // never fired and the error surfaced as a 200 + STREAM_ERROR frame.
  it('throws PipelineError(OLLAMA_UNREACHABLE, 503) when the orchestrator cannot reach Ollama', async () => {
    const unreachable = new Error('connect ECONNREFUSED 127.0.0.1:11434') as Error & {
      code: string;
    };
    unreachable.code = 'OLLAMA_UNREACHABLE';
    const client = makeClient({
      chatOnce: () => Promise.reject(unreachable),
    });
    const registry = makeRegistry(makeSnapshot([makeAgent('advisory')]));

    await expect(runChatPipeline(makeOpts({ client, registry }))).rejects.toBeInstanceOf(
      PipelineError,
    );

    let captured: unknown;
    try {
      await runChatPipeline(makeOpts({ client, registry }));
    } catch (err) {
      captured = err;
    }
    expect(captured).toMatchObject({
      name: 'PipelineError',
      code: 'OLLAMA_UNREACHABLE',
      status: 503,
    });
  });

  it('throws PipelineError(MODEL_MISSING, 503) when the orchestrator reports the model is not pulled', async () => {
    const missing = new Error("model 'gemma4:e4b' not found, status 404") as Error & {
      code: string;
    };
    missing.code = 'MODEL_MISSING';
    const client = makeClient({
      chatOnce: () => Promise.reject(missing),
    });
    const registry = makeRegistry(makeSnapshot([makeAgent('advisory')]));

    await expect(
      runChatPipeline(makeOpts({ client, registry })),
    ).rejects.toMatchObject({
      code: 'MODEL_MISSING',
      status: 503,
    });
  });

  it('throws PipelineError(NO_AGENTS_LOADED, 500) when the registry has no agents', async () => {
    // chatOnce must not even be reached.
    const client = makeClient({
      chatOnce: () => ({ content: '{"agentsToRun":[],"reasoning":""}' }),
    });
    const registry = makeRegistry(makeSnapshot([]));

    await expect(
      runChatPipeline(makeOpts({ client, registry })),
    ).rejects.toMatchObject({
      code: 'NO_AGENTS_LOADED',
      status: 500,
    });
    expect(client.chatOnce).not.toHaveBeenCalled();
  });
});
