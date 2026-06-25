import { Ollama } from 'ollama';
import { DEFAULT_LOCAL_MODEL } from './models.js';
import { createOllamaStreamAdapter, wrapOllamaError } from './stream.js';
export function createOllamaClient(options) {
    const { apiKey, host, model = DEFAULT_LOCAL_MODEL, ollama: provided, timeoutMs } = options;
    const ollama = provided ??
        new Ollama({
            host: toOllamaClientHost(host),
            fetch: buildFetchWithTimeout(timeoutMs),
            ...(apiKey ? { headers: { Authorization: `Bearer ${apiKey}` } } : {}),
        });
    const stream = createOllamaStreamAdapter(ollama, model);
    return {
        async chatOnce(args) {
            if (hasImages(args.messages)) {
                throw new Error('chatOnce/chatStream do not accept images in v1 (R12).');
            }
            if (args.signal?.aborted) {
                throw args.signal.reason instanceof Error
                    ? args.signal.reason
                    : new Error('aborted');
            }
            let timer;
            let abortHandler;
            try {
                const chatPromise = (async () => {
                    const res = await ollama.chat({
                        model,
                        messages: [{ role: 'system', content: args.system }, ...args.messages],
                        stream: false,
                        ...(args.format ? { format: args.format } : {}),
                    });
                    return { content: res.message?.content ?? '' };
                })();
                const timeoutPromise = new Promise((_, reject) => {
                    timer = setTimeout(() => {
                        const e = new Error(`chatOnce exceeded ${timeoutMs}ms`);
                        e.code = 'OLLAMA_TIMEOUT';
                        reject(e);
                    }, timeoutMs);
                });
                const racers = [
                    chatPromise,
                    timeoutPromise,
                ];
                if (args.signal) {
                    const signal = args.signal;
                    racers.push(new Promise((_, reject) => {
                        abortHandler = () => {
                            reject(signal.reason instanceof Error
                                ? signal.reason
                                : new Error('aborted'));
                        };
                        signal.addEventListener('abort', abortHandler, { once: true });
                    }));
                }
                return await Promise.race(racers);
            }
            catch (err) {
                if (err?.code === 'OLLAMA_TIMEOUT') {
                    throw err;
                }
                throw wrapOllamaError(err);
            }
            finally {
                if (timer)
                    clearTimeout(timer);
                if (args.signal && abortHandler) {
                    args.signal.removeEventListener('abort', abortHandler);
                }
            }
        },
        chatStream: stream.chatStream,
        async checkModel() {
            try {
                await ollama.show({ model });
            }
            catch (err) {
                throw wrapOllamaError(err);
            }
        },
    };
}
export function toOllamaClientHost(host) {
    return host.replace(/\/+$/, '').replace(/\/api$/, '');
}
function hasImages(messages) {
    return messages.some((m) => Array.isArray(m.images) && m.images.length > 0);
}
function buildFetchWithTimeout(timeoutMs) {
    return (input, init) => {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(new Error('timeout')), timeoutMs);
        const upstreamSignal = init?.signal;
        if (upstreamSignal) {
            if (upstreamSignal.aborted)
                ctl.abort(upstreamSignal.reason);
            else
                upstreamSignal.addEventListener('abort', () => ctl.abort(upstreamSignal.reason), { once: true });
        }
        return fetch(input, { ...init, signal: ctl.signal }).finally(() => clearTimeout(timer));
    };
}
