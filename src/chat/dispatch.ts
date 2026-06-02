import type {
  AgentResult,
  ChatRequest,
  DoneEnvelope,
  Lang,
  Message,
  SSEEvent,
} from './schemas.js';
import { isModelMissing, isOllamaUnreachable, PipelineError } from './errors.js';
import type { ColdStartGate } from './coldStart.js';
import type { OllamaClient } from '../ollama/interface.js';
import type { Semaphore } from '../dispatch/semaphore.js';
import type { OrchestratorDecision } from '../dispatch/types.js';
import { route } from '../dispatch/orchestrator.js';
import { runAgents } from '../dispatch/parallel.js';
import { streamSynthesizeChunks } from '../dispatch/synthesizer.js';
import type {
  ArtifactRegistry,
  ArtifactRegistrySnapshot,
} from '../loaders/registry.js';
import { inc } from '../observability/metrics.js';
import { getDefaultLogger, type Logger } from '../observability/logger.js';

const WARNINGS: Record<
  'en' | 'es',
  { partial: string; allFailed: string; noAgents: string }
> = {
  en: {
    partial: 'Some agents reported partial failures; the answer may be incomplete.',
    allFailed: 'All agents failed.',
    noAgents:
      "I couldn't match your question to a Taxalia service. Please mention if you need advisory, valuation, or financial help and I'll route you to the right assistant.",
  },
  es: {
    partial: 'Algunos agentes reportaron fallos parciales; la respuesta podría estar incompleta.',
    allFailed: 'Todos los agentes fallaron.',
    noAgents:
      'No pude identificar a qué servicio de Taxalia corresponde tu pregunta. Indicanos si necesitás asesoría, valoración o ayuda financiera y te derivamos al asistente correcto.',
  },
};

export type ChatRouteDeps = {
  client: OllamaClient;
  semaphore: Semaphore;
  agentTimeoutMs: number;
  coldStart: ColdStartGate;
  /**
   * Optional structured logger. When omitted the route falls back to
   * the process-wide default logger, which honors LOG_LEVEL and stays
   * silent under NODE_ENV=test.
   */
  logger?: Logger;
  /**
   * Optional override that lets integration tests replace the
   * full pipeline with a simpler stub while still exercising the route.
   * When provided, the route uses it instead of the default
   * `runChatPipeline`.
   */
  pipelineOverride?: (opts: PipelineRunOptions) => Promise<PipelineResult>;
};

export type PipelineRunOptions = {
  request: ChatRequest;
  requestId: string;
  signal: AbortSignal;
  client: OllamaClient;
  semaphore: Semaphore;
  agentTimeoutMs: number;
  coldStart: ColdStartGate;
  registry: ArtifactRegistry;
  /**
   * Optional request-scoped logger (usually a child of the route
   * logger pre-bound with `{ requestId }`). When omitted the
   * pipeline derives one from `getDefaultLogger()`.
   */
  logger?: Logger;
};

export type PipelineResult = {
  events: AsyncIterable<SSEEvent>;
};

/**
 * Build the SSE event stream for a chat request.
 *
 * Pre-stream failures (validation, Ollama unreachable, model missing, system
 * prompt too large) are thrown SYNCHRONOUSLY from this `async` function so
 * the route can map them to HTTP 400/500/503 before opening the SSE
 * connection. Only failures that happen AFTER the stream has opened (e.g.
 * synthesizer mid-stream errors) surface as a terminal SSE error frame.
 *
 * Returns an async iterable of `SSEEvent` values: zero or more
 * `{ delta: string }` events followed by exactly one `{ done: true, ... }`
 * event.
 */
export async function runChatPipeline(
  opts: PipelineRunOptions,
): Promise<PipelineResult> {
  const preflight = await preflightPipeline(opts);
  return { events: postStreamEvents(preflight) };
}

type PreflightResult = {
  requestId: string;
  lang: Lang;
  userMessage: string;
  selectedAgents: Array<{ id: string }>;
  agentResults: AgentResult[];
  okResults: AgentResult[];
  allFailed: boolean;
  partial: boolean;
  client: OllamaClient;
  signal: AbortSignal;
  logger: Logger;
};

/**
 * Run everything that must succeed BEFORE the SSE stream opens:
 * request validation, agent registry check, orchestrator route, and
 * parallel agent dispatch. Throws `PipelineError` for any pre-stream
 * failure that maps to an HTTP error code; otherwise returns a snapshot
 * that the post-stream generator can stream from.
 */
async function preflightPipeline(
  opts: PipelineRunOptions,
): Promise<PreflightResult> {
  const { request, requestId, signal } = opts;
  const logger =
    opts.logger ?? getDefaultLogger().child({ requestId, layer: 'pipeline' });
  const lang = request.lang;
  const last = lastUserMessage(request.messages);
  if (!last) {
    logger.warn({ stage: 'preflight' }, 'empty user message');
    throw new PipelineError('EMPTY_MESSAGE', 400, 'Last user message is empty.');
  }
  const userMessage = last.content;
  const snap = opts.registry.snapshot();
  if (snap.agents.length === 0) {
    logger.error({ stage: 'preflight' }, 'no agents loaded; cannot route');
    throw new PipelineError(
      'NO_AGENTS_LOADED',
      500,
      'No agents are loaded; cannot route the request.',
    );
  }

  logger.info(
    {
      stage: 'preflight-start',
      lang,
      messageCount: request.messages.length,
      userMessageChars: userMessage.length,
      agentsAvailable: snap.agents.length,
      isCold: opts.coldStart.isCold(),
    },
    'chat preflight start',
  );

  const orchestratorStart = performance.now();
  const decision = await runOrchestrator({
    userMessage,
    agents: snap.agents,
    lang,
    client: opts.client,
    requestId,
    signal,
    logger,
  });
  const orchestratorMs = Math.round(performance.now() - orchestratorStart);

  const selectedAgents = snap.agents.filter((a) =>
    decision.agentsToRun.includes(a.id),
  );

  logger.info(
    {
      stage: 'orchestrator-done',
      orchestratorMs,
      selectedCount: selectedAgents.length,
      selectedIds: selectedAgents.map((a) => a.id),
      reasoningChars: (decision.reasoning ?? '').length,
    },
    'orchestrator decision',
  );

  const dispatchStart = performance.now();
  const agentResults = await runDispatch({
    selected: selectedAgents,
    snap,
    history: request.messages,
    lang,
    requestId,
    client: opts.client,
    signal,
    semaphore: opts.semaphore,
    agentTimeoutMs: opts.agentTimeoutMs,
    coldStart: opts.coldStart,
    logger,
  });
  const dispatchMs = Math.round(performance.now() - dispatchStart);

  const failures = agentResults.filter((r) => r.status === 'error');
  const okResults = agentResults.filter((r) => r.status === 'ok');
  const allFailed = okResults.length === 0;
  const partial = failures.length > 0 && !allFailed;

  logger.info(
    {
      stage: 'dispatch-done',
      dispatchMs,
      okCount: okResults.length,
      errorCount: failures.length,
      allFailed,
      partial,
      durations: agentResults.map((r) => ({
        id: r.id,
        status: r.status,
        ms: r.durationMs,
        code: r.error?.code,
      })),
    },
    'agent dispatch result',
  );

  return {
    requestId,
    lang,
    userMessage,
    selectedAgents,
    agentResults,
    okResults,
    allFailed,
    partial,
    client: opts.client,
    signal,
    logger,
  };
}

async function runOrchestrator(args: {
  userMessage: string;
  agents: ArtifactRegistrySnapshot['agents'];
  lang: Lang;
  client: OllamaClient;
  requestId: string;
  signal: AbortSignal;
  logger: Logger;
}): Promise<OrchestratorDecision> {
  try {
    return await route({
      userMessage: args.userMessage,
      agents: args.agents,
      lang: args.lang,
      client: args.client,
      requestId: args.requestId,
      signal: args.signal,
      logger: args.logger,
    });
  } catch (err) {
    if (isOllamaUnreachable(err)) {
      args.logger.error(
        { stage: 'orchestrator', code: 'OLLAMA_UNREACHABLE' },
        'Ollama unreachable during orchestrator',
      );
      throw new PipelineError(
        'OLLAMA_UNREACHABLE',
        503,
        'Ollama is unreachable. Is the local server running on :11434?',
      );
    }
    if (isModelMissing(err)) {
      args.logger.error(
        { stage: 'orchestrator', code: 'MODEL_MISSING' },
        'Model missing during orchestrator',
      );
      throw new PipelineError(
        'MODEL_MISSING',
        503,
        "Model 'gemma4:e4b' is not pulled. Run 'npm run setup' to install it.",
      );
    }
    args.logger.error(
      { stage: 'orchestrator', err: errorSummary(err) },
      'orchestrator threw unexpected error',
    );
    throw err;
  }
}

async function runDispatch(args: {
  selected: ArtifactRegistrySnapshot['agents'];
  snap: ArtifactRegistrySnapshot;
  history: Message[];
  lang: Lang;
  requestId: string;
  client: OllamaClient;
  signal: AbortSignal;
  semaphore: Semaphore;
  agentTimeoutMs: number;
  coldStart: ColdStartGate;
  logger: Logger;
}): Promise<AgentResult[]> {
  const coldBudget = args.coldStart.takeColdBudgetMs();
  const perAgentTimeout = Math.max(args.agentTimeoutMs, coldBudget ?? 0);
  if (coldBudget !== null) {
    args.logger.info(
      {
        stage: 'cold-start',
        coldBudgetMs: coldBudget,
        perAgentTimeoutMs: perAgentTimeout,
      },
      'cold-start budget consumed for first dispatch',
    );
  }
  try {
    return await runAgents({
      selected: args.selected,
      history: args.history,
      lang: args.lang,
      conducta: args.snap.conducta,
      skills: args.snap.skills,
      client: args.client,
      signal: args.signal,
      requestId: args.requestId,
      timeoutMs: perAgentTimeout,
      semaphore: args.semaphore,
    });
  } catch (err) {
    if (isOllamaUnreachable(err)) {
      args.logger.error(
        { stage: 'dispatch', code: 'OLLAMA_UNREACHABLE' },
        'Ollama unreachable during agent dispatch',
      );
      throw new PipelineError(
        'OLLAMA_UNREACHABLE',
        503,
        'Ollama is unreachable during agent dispatch.',
      );
    }
    if (isModelMissing(err)) {
      args.logger.error(
        { stage: 'dispatch', code: 'MODEL_MISSING' },
        'Model missing during agent dispatch',
      );
      throw new PipelineError(
        'MODEL_MISSING',
        503,
        "Model 'gemma4:e4b' is not pulled. Run 'npm run setup' to install it.",
      );
    }
    args.logger.error(
      { stage: 'dispatch', err: errorSummary(err) },
      'dispatch threw unexpected error',
    );
    throw err;
  }
}

/**
 * Build the post-stream SSE events from a successful preflight. The
 * generator never throws for failures the route could have mapped to
 * HTTP errors — those are surfaced from `preflightPipeline` instead.
 * Failures here (e.g. the synthesizer stream itself erroring) are
 * caught by the route and emitted as a terminal SSE error frame.
 */
async function* postStreamEvents(
  p: PreflightResult,
): AsyncGenerator<SSEEvent, void, void> {
  const {
    requestId,
    lang,
    userMessage,
    selectedAgents,
    agentResults,
    okResults,
    allFailed,
    partial,
    client,
    signal,
    logger,
  } = p;

  // Edge: orchestrator picked nothing (and keyword fallback had no
  // match either) → emit a single delta with a localized warning so
  // the user always sees something useful. This is the deterministic
  // safety net: the user must never see a terminal `done` with
  // `agents: []` and no text.
  if (selectedAgents.length === 0) {
    const message = WARNINGS[lang].noAgents;
    logger.warn(
      { stage: 'stream', path: 'no-agents-selected', lang, messageChars: message.length },
      'no agents selected; emitting localized fallback to user',
    );
    yield { delta: message };
    yield {
      done: true,
      agents: [],
      warning: message,
      requestId,
    };
    return;
  }

  // Single-agent path: forward the agent's text directly (synthesizer
  // is skipped per dispatch R7).
  if (selectedAgents.length < 2) {
    logger.info(
      {
        stage: 'stream',
        path: 'single-agent',
        agentId: selectedAgents[0]?.id,
        hasText: okResults[0]?.text != null && okResults[0].text.length > 0,
        allFailed,
      },
      'single-agent path',
    );
    if (okResults.length > 0 && okResults[0].text) {
      yield { delta: okResults[0].text };
    } else if (allFailed) {
      yield { delta: WARNINGS[lang].allFailed };
    }
    yield {
      done: true,
      agents: agentResults,
      warning: allFailed ? WARNINGS[lang].allFailed : undefined,
      requestId,
    };
    return;
  }

  // Multi-agent path: run the synthesizer with the successful outputs.
  logger.info(
    {
      stage: 'stream',
      path: 'multi-agent-synth',
      okCount: okResults.length,
      allFailed,
      partial,
    },
    'multi-agent synthesizer path start',
  );
  const synthStream = streamSynthesizeChunks({
    userMessage,
    agentResults,
    lang,
    client,
    signal,
  });

  if (synthStream === null) {
    // Defensive: should not happen here because we have 2+ selected
    // and at least one OK result (we already covered allFailed below).
    logger.warn(
      { stage: 'stream', path: 'synth-skipped-defensive' },
      'synth skipped unexpectedly',
    );
    yield {
      done: true,
      agents: agentResults,
      warning: allFailed ? WARNINGS[lang].allFailed : WARNINGS[lang].partial,
      requestId,
    };
    return;
  }

  if (allFailed) {
    inc('dispatch_total_failures_total');
    logger.warn(
      { stage: 'stream', path: 'all-failed' },
      'all agents failed; emitting done with warning',
    );
    yield { delta: WARNINGS[lang].allFailed };
    yield {
      done: true,
      agents: agentResults,
      warning: WARNINGS[lang].allFailed,
      requestId,
    };
    return;
  }

  // Stream the synth chunks. We accumulate into a string so we can
  // detect the case where the synthesizer emits nothing (e.g., empty
  // model output) and surface the per-agent outputs as a fallback.
  const synthStart = performance.now();
  let synthText = '';
  let synthChunks = 0;
  for await (const chunk of synthStream) {
    synthText += chunk;
    synthChunks += 1;
    yield { delta: chunk };
  }
  logger.info(
    {
      stage: 'stream',
      synthMs: Math.round(performance.now() - synthStart),
      synthChars: synthText.length,
      synthChunks,
    },
    'synthesizer stream complete',
  );

  // If the synth stream produced no text, fall back to the per-agent
  // text directly so the client always gets something.
  if (synthText.length === 0 && okResults.length > 0) {
    logger.warn(
      { stage: 'stream', path: 'synth-empty-fallback', okCount: okResults.length },
      'synthesizer produced no text; falling back to agent outputs',
    );
    for (const r of okResults) {
      if (r.text) {
        yield { delta: r.text };
        yield { delta: '\n' };
      }
    }
  }

  const finalEvent: DoneEnvelope = {
    done: true,
    agents: agentResults,
    warning: partial ? WARNINGS[lang].partial : undefined,
    requestId,
  };
  yield finalEvent;
}

function lastUserMessage(messages: Message[]): Message | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return messages[i];
  }
  return undefined;
}

function errorSummary(err: unknown): { name?: string; message: string; code?: string } {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      code: (err as Error & { code?: string }).code,
    };
  }
  return { message: String(err) };
}
