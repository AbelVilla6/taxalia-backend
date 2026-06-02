import type { AgentDef } from '../agents/loader.js';
import type { ConductDef } from '../conducta/loader.js';
import type { Lang, Message, AgentResult } from '../chat/schemas.js';
import type { SkillDef } from '../skills/loader.js';
import type { OllamaClient } from '../ollama/interface.js';
import { inc } from '../observability/metrics.js';
import { assembleSystemPrompt, SystemPromptTooLargeError } from './systemPrompt.js';
import type { Semaphore } from './semaphore.js';
import type { DispatchResult } from './types.js';

export type RunAgentsArgs = {
  selected: AgentDef[];
  history: Message[];
  lang: Lang;
  conducta: ConductDef[];
  skills: SkillDef[];
  client: OllamaClient;
  signal: AbortSignal;
  requestId: string;
  timeoutMs: number;
  semaphore: Semaphore;
};

class AgentTimeoutSignal extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`agent-timeout:${timeoutMs}ms`);
    this.name = 'AgentTimeoutSignal';
  }
}

export async function runAgents(args: RunAgentsArgs): Promise<DispatchResult> {
  if (args.selected.length === 0) return [];

  await args.semaphore.acquire();
  try {
    const tasks = args.selected.map((agent) =>
      runOne(agent, args).catch((err) => errorResult(agent.id, err, args.timeoutMs)),
    );
    const settled = await Promise.allSettled(tasks);

    const result: DispatchResult = settled.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      return errorResult(args.selected[i].id, r.reason, args.timeoutMs);
    });

    const failures = result.filter((r) => r.status === 'error').length;
    if (failures > 0) {
      inc('partial_failure_total');
      inc('dispatch_partial_failures_total');
    }
    if (failures === result.length && result.length > 0) {
      inc('dispatch_total_failures_total');
    }
    return result;
  } finally {
    args.semaphore.release();
  }
}

async function runOne(agent: AgentDef, args: RunAgentsArgs): Promise<AgentResult> {
  const startedAt = performance.now();
  const controller = new AbortController();
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new AgentTimeoutSignal(args.timeoutMs));
  }, args.timeoutMs);

  const onOuterAbort = () => controller.abort(args.signal.reason);
  if (args.signal.aborted) controller.abort(args.signal.reason);
  else args.signal.addEventListener('abort', onOuterAbort, { once: true });

  try {
    const system = assembleSystemPrompt({
      lang: args.lang,
      conducta: args.conducta,
      agent: { systemPrompt: agent.systemPrompt },
      skills: args.skills.map((s) => ({ id: s.id, description: s.description })),
    });

    const history = structuredClone(args.history);
    const stream = args.client.chatStream({
      system,
      messages: history,
      signal: controller.signal,
    });

    let text = '';
    let streamError: unknown = undefined;

    // Drain the stream in the background so a hanging/never-yielding stream
    // (real or mock) can still be interrupted by the per-agent timeout or by
    // the outer request abort. We race the drain against the controller's
    // abort signal and only surface errors that did not originate from
    // timeout/abort.
    const drain = (async () => {
      try {
        for await (const delta of stream) {
          if (controller.signal.aborted) break;
          text += delta;
        }
      } catch (err) {
        streamError = err;
      }
    })();

    const aborted = new Promise<void>((resolve) => {
      if (controller.signal.aborted) {
        resolve();
        return;
      }
      controller.signal.addEventListener('abort', () => resolve(), { once: true });
    });

    await Promise.race([drain, aborted]);

    if (timedOut) {
      inc('agent_timeout_total', { agent_id: agent.id });
      return {
        id: agent.id,
        status: 'error',
        error: { code: 'TIMEOUT' },
        durationMs: args.timeoutMs,
      };
    }

    if (streamError) {
      throw streamError;
    }

    if (controller.signal.aborted) {
      return {
        id: agent.id,
        status: 'error',
        error: { code: 'ABORTED', message: 'request aborted' },
        durationMs: Math.round(performance.now() - startedAt),
      };
    }

    return {
      id: agent.id,
      status: 'ok',
      text,
      durationMs: Math.round(performance.now() - startedAt),
    };
  } catch (err) {
    if (timedOut) {
      inc('agent_timeout_total', { agent_id: agent.id });
      return {
        id: agent.id,
        status: 'error',
        error: { code: 'TIMEOUT' },
        durationMs: args.timeoutMs,
      };
    }
    return errorResult(agent.id, err, args.timeoutMs, startedAt);
  } finally {
    clearTimeout(timer);
    args.signal.removeEventListener('abort', onOuterAbort);
  }
}

function errorResult(
  id: string,
  err: unknown,
  timeoutMs: number,
  startedAt?: number,
): AgentResult {
  const elapsed = startedAt != null ? Math.round(performance.now() - startedAt) : timeoutMs;
  const code = errorCode(err);
  if (code === 'TIMEOUT') {
    inc('agent_timeout_total', { agent_id: id });
  }
  return {
    id,
    status: 'error',
    error: {
      code,
      message: err instanceof Error ? err.message : String(err),
    },
    durationMs: elapsed,
  };
}

function errorCode(err: unknown): string {
  if (err instanceof SystemPromptTooLargeError) return 'SYSTEM_PROMPT_TOO_LARGE';
  if (err instanceof Error) {
    const code = (err as Error & { code?: string }).code;
    if (code) return code;
  }
  return 'OLLAMA_ERROR';
}

export const _internals = { runOne };
