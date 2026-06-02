import { z } from 'zod';
import type { AgentDef } from '../agents/loader.js';
import type { Lang } from '../chat/schemas.js';
import type {
  OllamaChatRequest,
  OllamaClient,
} from '../ollama/interface.js';
import { MODEL } from '../ollama/models.js';
import { inc } from '../observability/metrics.js';
import { createLogger } from '../observability/logger.js';
import {
  EMPTY_DECISION,
  OrchestratorDecisionSchema,
  type OrchestratorDecision,
} from './types.js';

const ORCHESTRATOR_TIMEOUT_MS = 10_000;

const ORCHESTRATOR_META_SP: Record<Lang, string> = {
  en: `You are a routing assistant for Taxalia. Given the user's last message and the list of available agents (one line each: "<id>: <description>"), respond ONLY with a JSON object of shape:
{ "agentsToRun": <AgentId[]>, "reasoning": "<one short sentence>" }
Pick zero or more agents whose scope matches the user's intent. Small talk and greetings return an empty array. Unknown intent returns an empty array. Never invent ids. Respond in English.`,
  es: `Sos el asistente de enrutamiento de Taxalia. Dada el último mensaje del usuario y la lista de agentes disponibles (una línea por agente: "<id>: <description>"), respondé SOLO con un objeto JSON con la forma:
{ "agentsToRun": <AgentId[]>, "reasoning": "<una oración corta>" }
Elegí cero o más agentes cuyo alcance coincida con la intención del usuario. Charla liviana y saludos devuelven un array vacío. Intención desconocida devuelve un array vacío. Nunca inventes ids. Respondé en español.`,
};

export type RouteArgs = {
  userMessage: string;
  agents: AgentDef[];
  lang: Lang;
  client: OllamaClient;
  requestId: string;
  signal?: AbortSignal;
  warn?: (msg: string) => void;
  timeoutMs?: number;
};

export async function route(args: RouteArgs): Promise<OrchestratorDecision> {
  inc('dispatch_orchestrator_calls_total');
  const logger = createLogger('silent').child({ requestId: args.requestId });
  const warn = args.warn ?? ((m) => logger.warn(m));

  const summaries = args.agents.map((a) => `${a.id}: ${a.description}`).join('\n');
  const userContent = `${args.userMessage}\n\nAvailable agents:\n${summaries}`;
  const messages = [{ role: 'user' as const, content: userContent }];
  const signal = args.signal ??
    AbortSignal.timeout(args.timeoutMs ?? ORCHESTRATOR_TIMEOUT_MS);

  const timeoutMs = args.timeoutMs ?? ORCHESTRATOR_TIMEOUT_MS;
  let raw: { content: string };
  try {
    const req: OllamaChatRequest = {
      system: ORCHESTRATOR_META_SP[args.lang],
      messages,
      format: 'json',
      signal,
    };
    raw = await chatOnceWithTimeout(
      args.client,
      req,
      timeoutMs,
    );
  } catch (err) {
    const code = (err as { code?: unknown } | null)?.code;
    if (code === 'OLLAMA_UNREACHABLE' || code === 'MODEL_MISSING') {
      throw err;
    }
    inc('orchestrator_parse_error_total');
    const isTimeout = code === 'ORCHESTRATOR_TIMEOUT';
    warn(
      `orchestrator:${isTimeout ? 'timeout' : 'chat-failed'} ${errorMessage(err)}`,
    );
    return EMPTY_DECISION;
  }

  let decision: OrchestratorDecision;
  try {
    const parsed = OrchestratorDecisionSchema.safeParse(safeJsonParse(raw.content));
    if (!parsed.success) throw parsed.error;
    decision = parsed.data;
  } catch (err) {
    inc('orchestrator_parse_error_total');
    warn(`orchestrator:parse-failed ${errorMessage(err)}`);
    return EMPTY_DECISION;
  }

  const known = new Set(args.agents.map((a) => a.id));
  const dropped = decision.agentsToRun.filter((id) => !known.has(id));
  if (dropped.length > 0) {
    warn(
      `orchestrator:dropped-unknown-ids requestId=${args.requestId} dropped=[${dropped.join(',')}]`,
    );
  }
  decision.agentsToRun = decision.agentsToRun.filter((id) => known.has(id));

  for (const id of decision.agentsToRun) {
    inc('dispatch_agents_selected_total', { agent_id: id });
  }

  return decision;
}

function safeJsonParse(content: string): unknown {
  // The model sometimes wraps JSON in ```json fences; strip them defensively.
  const trimmed = content.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```\s*$/i.exec(trimmed);
  const body = fence ? fence[1] : trimmed;
  return JSON.parse(body);
}

/**
 * Race a non-streaming `chatOnce` call against a hard timeout.
 *
 * Background: ollama-js v0.6.3 forwards `options.signal` to `fetch` only
 * on the streaming path; the non-streaming branch silently drops the
 * signal. Without this race, the orchestrator's 10s ceiling would be
 * observed by the caller (via `AbortSignal.timeout`) but never enforced
 * on the actual HTTP request, allowing a slow / hung model to stall
 * the request until the upstream fetch gives up.
 *
 * The race is what enforces the ceiling; the `signal` on the request
 * remains best-effort (useful for tests, and for clients that DO honor
 * signal on the non-streaming path).
 */
async function chatOnceWithTimeout(
  client: OllamaClient,
  req: OllamaChatRequest,
  timeoutMs: number,
): Promise<{ content: string }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const e = new Error(
        `orchestrator chatOnce exceeded ${timeoutMs}ms`,
      ) as Error & { code: string };
      e.code = 'ORCHESTRATOR_TIMEOUT';
      reject(e);
    }, timeoutMs);
  });
  try {
    return await Promise.race([client.chatOnce(req), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export const _testing = { ORCHESTRATOR_META_SP, MODEL };
