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
  // Spanish — income tax
  'renta': ['income-tax'],
  'impuest': ['income-tax'],
  'fiscal': ['income-tax'],
  'tributari': ['income-tax'],
  'declaración': ['income-tax'],
  'declaracion': ['income-tax'],
  'expat': ['income-tax'],
  'expatri': ['income-tax'],
  'fbar': ['income-tax'],
  'extranj': ['income-tax'],
  'internacional': ['income-tax'],
  'planificaci': ['income-tax'],
  // Spanish — business accounting
  'contab': ['business-accounting'],
  'contable': ['business-accounting'],
  'nómina': ['business-accounting'],
  'nomina': ['business-accounting'],
  'empresa': ['business-accounting'],
  'negocio': ['business-accounting'],
  'sociedad': ['business-accounting'],
  'corporaci': ['business-accounting'],
  // Spanish — IRS resolution
  'irs': ['irs-tax-resolution'],
  'aviso': ['irs-tax-resolution'],
  'deuda': ['irs-tax-resolution'],
  'multa': ['irs-tax-resolution'],
  'resoluci': ['irs-tax-resolution'],
  'atras': ['irs-tax-resolution'],
  // English — income tax
  'income tax': ['income-tax'],
  'tax return': ['income-tax'],
  'taxes': ['income-tax'],
  'foreign income': ['income-tax'],
  'fbars': ['income-tax'],
  'tax planning': ['income-tax'],
  'international tax': ['income-tax'],
  // English — business accounting
  'bookkeeping': ['business-accounting'],
  'accounting': ['business-accounting'],
  'payroll': ['business-accounting'],
  'corporate tax': ['business-accounting'],
  'small business': ['business-accounting'],
  'business accounting': ['business-accounting'],
  // English — IRS resolution
  'notice': ['irs-tax-resolution'],
  'back taxes': ['irs-tax-resolution'],
  'balance due': ['irs-tax-resolution'],
  'debt': ['irs-tax-resolution'],
  'resolution': ['irs-tax-resolution'],
  'penalty': ['irs-tax-resolution'],
  'audit': ['irs-tax-resolution'],
};

const ORCHESTRATOR_META_SP: Record<Lang, string> = {
  en: `You are a routing assistant for Taxalia. Given the user's last message and the list of available service agents (one line each: "<id>: <description>"), respond ONLY with a JSON object of shape:
{ "agentsToRun": <AgentId[]>, "reasoning": "<one short sentence>" }

Routing rules:
- Pick EVERY service agent whose scope matches the user's intent.
- "income-tax" handles personal returns, business income tax, international/expat tax, FBAR filings, and tax planning.
- "business-accounting" handles bookkeeping, corporation tax prep, small business accounting, and payroll.
- "irs-tax-resolution" handles IRS notices, back taxes, balance due problems, penalties, and compliance issues.
- Tax, income tax, expat, FBAR, bookkeeping, accounting, payroll, IRS, notice, debt, resolution, or business accounting questions MUST select at least one agent.
- Only return an empty array for pure small talk (greetings, "hi", "thanks", "hola", "gracias", emojis) with no service intent whatsoever.
- Never invent ids. Respond in English.`,
  es: `Eres el asistente de enrutamiento de Taxalia. Dado el ultimo mensaje del usuario y la lista de agentes de servicio disponibles (una linea por agente: "<id>: <description>"), responde SOLO con un objeto JSON con la forma:
{ "agentsToRun": <AgentId[]>, "reasoning": "<una oracion corta>" }

Reglas de enrutamiento:
- Elige TODOS los agentes de servicio cuyo alcance coincida con la intencion del usuario.
- "income-tax" maneja declaraciones personales, impuestos de negocio, impuestos internacionales/expat, FBAR y planificacion fiscal.
- "business-accounting" maneja contabilidad, preparacion fiscal corporativa, contabilidad de pequenas empresas y nomina.
- "irs-tax-resolution" maneja avisos del IRS, deudas pendientes, sanciones y problemas de cumplimiento.
- Preguntas sobre impuestos, renta, expat, FBAR, contabilidad, nomina, IRS, avisos, deudas, resolucion o business accounting DEBEN seleccionar al menos un agente.
- Solo devuelve un array vacio para charla pura (saludos, "hola", "gracias", emojis) sin ninguna intencion de servicio.
- Nunca inventes ids. Responde en castellano de Espana.`,
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
   * - that hook predates the structured logger and is used by tests
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
 * Pure, testable keyword to agent-id mapping. Scans the user message
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
