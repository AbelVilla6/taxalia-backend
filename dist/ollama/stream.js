export function createOllamaStreamAdapter(ollama, model) {
    return {
        async *chatStream({ system, messages, signal, }) {
            const ollamaMessages = [
                { role: 'system', content: system },
                ...messages,
            ];
            let iterator;
            try {
                const response = await ollama.chat({
                    model,
                    messages: ollamaMessages,
                    stream: true,
                });
                iterator = (async function* () {
                    for await (const part of response) {
                        yield part;
                    }
                })();
                if (signal.aborted) {
                    response.abort();
                    return;
                }
                signal.addEventListener('abort', () => {
                    response.abort();
                }, { once: true });
            }
            catch (err) {
                throw wrapOllamaError(err);
            }
            try {
                for await (const part of iterator) {
                    if (signal.aborted)
                        return;
                    const content = part?.message?.content;
                    if (typeof content === 'string' && content.length > 0) {
                        yield content;
                    }
                }
            }
            catch (err) {
                if (signal.aborted)
                    return;
                throw wrapOllamaError(err);
            }
        },
    };
}
export function wrapOllamaError(err) {
    const base = err instanceof Error ? err : new Error(String(err));
    const message = base.message ?? '';
    if (/ECONNREFUSED|fetch failed|connect ECONNREFUSED|ENOTFOUND|socket hang up/i.test(message)) {
        const wrapped = new Error(`Ollama is unreachable: ${message}. Run 'npm run setup'.`);
        wrapped.code = 'OLLAMA_UNREACHABLE';
        wrapped.cause = base;
        return wrapped;
    }
    if (/model .*not found|404/i.test(message)) {
        const wrapped = new Error(`Model not found: ${message}. Run 'npm run setup'.`);
        wrapped.code = 'MODEL_MISSING';
        wrapped.cause = base;
        return wrapped;
    }
    const wrapped = new Error(message || 'Ollama call failed.');
    wrapped.code = 'OLLAMA_ERROR';
    wrapped.cause = base;
    return wrapped;
}
