import type { AgentResult, Lang, Message } from '../chat/schemas.js';
import type { OllamaClient } from '../ollama/interface.js';
import { inc } from '../observability/metrics.js';

const SYNTHESIZER_SP: Record<Lang, string> = {
  en: "You are Lexi's synthesis layer. Merge the following agent replies into one coherent answer. If any agent reported a partial failure, include a brief acknowledgment. Respond in the same language as the user's message.",
  es: 'Sos la capa de síntesis de Lexi. Fusioná las siguientes respuestas de los agentes en una respuesta coherente. Si algún agente reportó un fallo parcial, incluí un breve reconocimiento. Respondé en el mismo idioma que el mensaje del usuario.',
};

export type SynthesizeArgs = {
  userMessage: string;
  agentResults: AgentResult[];
  lang: Lang;
  client: OllamaClient;
  signal?: AbortSignal;
};

export type SynthesizeResult = {
  text: string;
};

/**
 * Merge parallel agent replies into a single coherent response.
 *
 * Skips when:
 *   - fewer than 2 agents were selected, OR
 *   - every selected agent errored.
 *
 * Input boundary: `agentResults` is the `DispatchResult` from `runAgents`
 * (4.5). This module never touches the original request session, the
 * per-token streams, or the abort reason. PR4-B's chat route is
 * responsible for forwarding the synthesized text to the SSE response.
 */
export async function synthesize(
  args: SynthesizeArgs,
): Promise<SynthesizeResult | null> {
  if (shouldSkipSynthesize(args.agentResults)) return null;
  inc('dispatch_synthesizer_calls_total');

  let text = '';
  for await (const chunk of synthesizeChunks(args)) {
    text += chunk;
  }
  return { text };
}

/**
 * Streaming variant used by the chat route. Returns an `AsyncIterable<string>`
 * of synthesizer chunks (non-empty deltas from Ollama). Returns `null` when
 * the synthesizer should be skipped (length < 2 OR all selected agents
 * errored).
 */
export function streamSynthesizeChunks(
  args: SynthesizeArgs,
): AsyncIterable<string> | null {
  if (shouldSkipSynthesize(args.agentResults)) return null;
  inc('dispatch_synthesizer_calls_total');
  return synthesizeChunks(args);
}

function shouldSkipSynthesize(agentResults: AgentResult[]): boolean {
  if (agentResults.length < 2) return true;
  const okResults = agentResults.filter(
    (r) => r.status === 'ok' && typeof r.text === 'string',
  );
  if (okResults.length === 0) return true;
  return false;
}

async function* synthesizeChunks(
  args: SynthesizeArgs,
): AsyncGenerator<string, void, void> {
  const okResults = args.agentResults.filter(
    (r) => r.status === 'ok' && typeof r.text === 'string',
  );

  const messages: Message[] = [
    { role: 'user', content: args.userMessage },
    ...okResults.map((r) => ({ role: 'assistant' as const, content: r.text ?? '' })),
  ];

  const controller = new AbortController();
  const parentSignal = args.signal;
  if (parentSignal) {
    if (parentSignal.aborted) controller.abort(parentSignal.reason);
    else
      parentSignal.addEventListener(
        'abort',
        () => controller.abort(parentSignal.reason),
        { once: true },
      );
  }

  const source = args.client.chatStream({
    system: SYNTHESIZER_SP[args.lang],
    messages,
    signal: controller.signal,
  });

  for await (const delta of source) {
    if (controller.signal.aborted) return;
    if (typeof delta === 'string' && delta.length > 0) {
      yield delta;
    }
  }
}

export const _testing = { SYNTHESIZER_SP };
