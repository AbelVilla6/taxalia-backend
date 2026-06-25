import { inc } from '../observability/metrics.js';
const SYNTHESIZER_SP = {
    en: [
        "You are Lexi's synthesis layer. Merge the following agent replies into one coherent answer. If any agent reported a partial failure, include a brief acknowledgment. Respond in the same language as the user's message.",
        'Keep the visible answer as Markdown text.',
        'Keep the final answer to 20 words or fewer. If the user truly needs a longer answer, use at most 50 words.',
        'If the source replies include a valid fenced `taxalia-options-json` block, preserve exactly one valid block at the very end of the final answer unchanged.',
        'The only valid options fence is `taxalia-options-json`; never use the generic JSON fence for options.',
        'Do not emit the options block when no choice is needed.',
    ].join(' '),
    es: [
        'Eres la capa de síntesis de Lexi. Fusiona las siguientes respuestas de los agentes en una respuesta coherente. Si algún agente reportó un fallo parcial, incluye un breve reconocimiento. Responde en castellano de España cuando el mensaje del usuario esté en español.',
        'Mantén la respuesta visible como texto Markdown.',
        'Mantén la respuesta final en 20 palabras o menos. Si el usuario realmente necesita una respuesta más larga, usa como máximo 50 palabras.',
        'Si las respuestas de origen incluyen un bloque fenced válido `taxalia-options-json`, preserva exactamente un bloque válido al final de la respuesta final sin modificarlo.',
        'El único fence válido para opciones es `taxalia-options-json`; nunca uses el fence genérico de JSON para opciones.',
        'No emitas el bloque de opciones cuando no haga falta elegir.',
    ].join(' '),
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
export async function synthesize(args) {
    if (shouldSkipSynthesize(args.agentResults))
        return null;
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
export function streamSynthesizeChunks(args) {
    if (shouldSkipSynthesize(args.agentResults))
        return null;
    inc('dispatch_synthesizer_calls_total');
    return synthesizeChunks(args);
}
function shouldSkipSynthesize(agentResults) {
    if (agentResults.length < 2)
        return true;
    const okResults = agentResults.filter((r) => r.status === 'ok' && typeof r.text === 'string');
    if (okResults.length === 0)
        return true;
    return false;
}
async function* synthesizeChunks(args) {
    const okResults = args.agentResults.filter((r) => r.status === 'ok' && typeof r.text === 'string');
    const messages = [
        { role: 'user', content: args.userMessage },
        ...okResults.map((r) => ({ role: 'assistant', content: r.text ?? '' })),
    ];
    const controller = new AbortController();
    const parentSignal = args.signal;
    if (parentSignal) {
        if (parentSignal.aborted)
            controller.abort(parentSignal.reason);
        else
            parentSignal.addEventListener('abort', () => controller.abort(parentSignal.reason), { once: true });
    }
    const source = args.client.chatStream({
        system: SYNTHESIZER_SP[args.lang],
        messages,
        signal: controller.signal,
    });
    for await (const delta of source) {
        if (controller.signal.aborted)
            return;
        if (typeof delta === 'string' && delta.length > 0) {
            yield delta;
        }
    }
}
export const _testing = { SYNTHESIZER_SP };
