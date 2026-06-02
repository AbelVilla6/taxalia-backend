import { z } from 'zod';
import type { AgentDef } from '../agents/loader.js';
import type { Lang } from '../chat/schemas.js';
import type {
  OllamaChatRequest,
  OllamaClient,
} from '../ollama/interface.js';
import { MODEL } from '../ollama/models.js';
import { inc } from '../observability/metrics.js';
import { getDefaultLogger, type Logger } from '../observability/logger.js';
import {
  EMPTY_DECISION,
  OrchestratorDecisionSchema,
  type OrchestratorDecision,
} from './types.js';

const ORCHESTRATOR_TIMEOUT_MS = 10_000;

/**
 * Keyword fallback map used when the LLM-based orchestrator returns
 * `agentsToRun: []` (e.g. small models under-infer routing, or the model
 * plays it safe on ambiguous prompts). Keys are lowercase substrings;
 * values are the agent ids to add to the decision in declared order.
 * Listed first wins on ties. This MUST stay in sync with the canonical
 * agent ids in `backend/src/agents/*.md`.
 */
export const KEYWORD_FALLBACK: Readonly<Record<string, readonly string[]>> = {
  // Spanish
  'valoraci': ['valuation'],
  'valoraci\u00f3n': ['valuation'],
  'tasaci': ['valuation'],
  'tasar': ['valuation'],
  'finanz': ['financial'],
  'financiero': ['financial'],
  'financiera': ['financial'],
  'contab': ['financial'],
  'contable': ['financial'],
  'asesor': ['advisory'],
  'asesor\u00eda': ['advisory'],
  'consultor': ['advisory'],
  'consultor\u00eda': ['advisory'],
  'empresa': ['advisory'],
  'negocio': ['valuation', 'advisory'],
  'impuest': ['financial'],
  'fiscal': ['financial'],
  'tributari': ['financial'],
  // English
  'valuati': ['valuation'],
  'value my': ['valuation'],
  'company valuation': ['valuation'],
  'financ': ['financial'],
  'financial plan': ['financial'],
  'financial review': ['financial'],
  'tax': ['financial'],
  'taxes': ['financial'],
  'tax planning': ['financial'],
  'account': ['financial'],
  'advisor': ['advisory'],
  'advisory': ['advisory'],
  'consult': ['advisory'],
  'engagement': ['advisory'],
  'quote': ['advisory'],
  'business': ['advisory', 'financial'],
};

const ORCHESTRATOR_META_SP: Record<Lang, string> = {
  en: `You are a routing assistant for Taxalia. Given the user's last message and the list of available agents (one line each: "<id>: <description>"), respond ONLY with a JSON object of shape:
{ "agentsToRun": <AgentId[]>, "reasoning": "<one short sentence>" }

Routing rules:
- Pick EVERY agent whose scope matches the user's intent (e.g. a "valuation + financial" prompt selects BOTH "valuation" and "financial").
- "valuation" handles company valuation, business worth, financial modeling, DCF, multiples, due diligence inputs.
- "financial" handles taxes, financial planning, accounting, reporting, cash flow.
- "advisory" handles engagement models, quotes, scheduling, general "what does Taxalia do" questions, and any business / service inquiry.
- Business, advisory, valuation, financial, accounting, tax, fiscal, company, M&A, due-diligence, or pricing questions MUST select at least one agent.
- Only return an empty array for pure small talk (greetings, "hi", "thanks", "hola", "gracias", emojis) with no business intent whatsoever.
- Never invent ids. Respond in English.`,
  es: `Sos el asistente de enrutamiento de Taxalia. Dada el último mensaje del usuario y la lista de agentes disponibles (una línea por agente: "<id>: <description>"), respondé SOLO con un objeto JSON con la forma:
{ "agentsToRun": <AgentId[]>, "reasoning": "<una oración corta>" }

Reglas de enrutamiento:
- Elegí TODOS los agentes cuyo alcance coincida con la intención del usuario (p.ej. un mensaje sobre "valoraci\u00f3n y finanzas" selecciona "valuation" Y "financial").
- "valuation" maneja valoración de empresas, valor del negocio, modelado financiero, DCF, múltiplos, inputs de due diligence.
- "financial" maneja impuestos, planificación financiera, contabilidad, reporting, flujo de caja.
- "advisory" maneja modelos de engagement, cotizaciones, agendar reuniones, preguntas generales tipo "qué hace Taxalia", y cualquier consulta sobre servicios / negocios.
- Preguntas sobre negocios, asesor\u00eda, valoración, finanzas, contabilidad, impuestos, fiscal, empresa, M&A, due diligence o precios DEBEN seleccionar al menos un agente.
- Solo devolvé un array vacío para charla pura (saludos, "hola", "gracias", emojis) sin ninguna intención de negocio.
- Nunca inventes ids. Respondé en español.`,
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
  /**
   * Optional structured logger. When omitted the orchestrator falls
   * back to the process-wide default (silent in tests, info otherwise).
   * Note: when an explicit `warn` callback is provided it still wins
   * — that hook predates the structured logger and is used by tests
   * to capture orchestrator-level warnings.
   */
  logger?: Logger;
};

export async function route(args: RouteArgs): Promise<OrchestratorDecision> {
  inc('dispatch_orchestrator_calls_total');
  const logger =
    args.logger ??
    getDefaultLogger().child({ requestId: args.requestId, layer: 'orchestrator' });
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

  // Deterministic safety net: small models under-infer routing and
  // frequently return [] for legitimate business prompts (especially
  // in Spanish). When the LLM picks nothing but the user message
  // contains a recognized business keyword, fall back to keyword-based
  // routing. This is logged so operators can tell when the model
  // under-routes and the fallback is rescuing the request.
  if (decision.agentsToRun.length === 0) {
    const fallback = keywordFallback(args.userMessage, args.agents);
    if (fallback.length > 0) {
      inc('dispatch_keyword_fallback_total');
      warn(
        `orchestrator:keyword-fallback requestId=${args.requestId} selected=[${fallback.join(',')}]`,
      );
      decision.agentsToRun = fallback;
      decision.reasoning = decision.reasoning
        ? `${decision.reasoning} (keyword fallback)`
        : 'keyword fallback (orchestrator returned empty)';
    }
  }

  for (const id of decision.agentsToRun) {
    inc('dispatch_agents_selected_total', { agent_id: id });
  }

  return decision;
}

/**
 * Pure, testable keyword → agent-id mapping. Scans the user message
 * (lowercased) for any of the substrings in `KEYWORD_FALLBACK` and
 * returns the de-duplicated, known agent ids, preserving the first
 * occurrence order from the keyword table. Unknown ids are dropped.
 */
export function keywordFallback(
  userMessage: string,
  agents: ReadonlyArray<{ id: string }>,
): string[] {
  const known = new Set(agents.map((a) => a.id));
  const haystack = userMessage.toLowerCase();
  const out: string[] = [];
  const seen = new Set<string>();
  for (const [needle, ids] of Object.entries(KEYWORD_FALLBACK)) {
    if (!haystack.includes(needle)) continue;
    for (const id of ids) {
      if (!known.has(id) || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out;
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

export const _testing = { ORCHESTRATOR_META_SP, MODEL, KEYWORD_FALLBACK };
