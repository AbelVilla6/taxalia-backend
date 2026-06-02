import { Ollama } from 'ollama';
import { MODEL } from './models.js';
import { createOllamaStreamAdapter, wrapOllamaError } from './stream.js';
import type {
  OllamaChatRequest,
  OllamaChatResponse,
  OllamaClient,
} from './interface.js';

export type OllamaClientOptions = {
  host: string;
  timeoutMs: number;
  ollama?: Ollama;
};

export function createOllamaClient(options: OllamaClientOptions): OllamaClient {
  const { host, ollama: provided, timeoutMs } = options;
  const ollama =
    provided ?? new Ollama({ host, fetch: buildFetchWithTimeout(timeoutMs) });
  const stream = createOllamaStreamAdapter(ollama);

  return {
    async chatOnce(args: OllamaChatRequest): Promise<OllamaChatResponse> {
      if (hasImages(args.messages)) {
        throw new Error('chatOnce/chatStream do not accept images in v1 (R12).');
      }
      if (args.signal?.aborted) {
        throw args.signal.reason instanceof Error
          ? args.signal.reason
          : new Error('aborted');
      }

      let timer: ReturnType<typeof setTimeout> | undefined;
      let abortHandler: (() => void) | undefined;
      try {
        const chatPromise = (async (): Promise<OllamaChatResponse> => {
          const res = await ollama.chat({
            model: MODEL,
            messages: [{ role: 'system', content: args.system }, ...args.messages],
            stream: false,
            ...(args.format ? { format: args.format } : {}),
          });
          return { content: res.message?.content ?? '' };
        })();

        const timeoutPromise = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            const e = new Error(
              `chatOnce exceeded ${timeoutMs}ms`,
            ) as Error & { code: string };
            e.code = 'OLLAMA_TIMEOUT';
            reject(e);
          }, timeoutMs);
        });

        const racers: Array<Promise<OllamaChatResponse>> = [
          chatPromise,
          timeoutPromise,
        ];
        if (args.signal) {
          const signal = args.signal;
          racers.push(
            new Promise<never>((_, reject) => {
              abortHandler = () => {
                reject(
                  signal.reason instanceof Error
                    ? signal.reason
                    : new Error('aborted'),
                );
              };
              signal.addEventListener('abort', abortHandler, { once: true });
            }),
          );
        }

        return await Promise.race(racers);
      } catch (err) {
        if ((err as { code?: unknown } | null)?.code === 'OLLAMA_TIMEOUT') {
          throw err;
        }
        throw wrapOllamaError(err);
      } finally {
        if (timer) clearTimeout(timer);
        if (args.signal && abortHandler) {
          args.signal.removeEventListener('abort', abortHandler);
        }
      }
    },

    chatStream: stream.chatStream,

    async checkModel(): Promise<void> {
      try {
        await ollama.show({ model: MODEL });
      } catch (err) {
        throw wrapOllamaError(err);
      }
    },
  };
}

function hasImages(
  messages: Array<{ role: string; content: string; images?: unknown[] }>,
): boolean {
  return messages.some((m) => Array.isArray(m.images) && m.images.length > 0);
}

function buildFetchWithTimeout(timeoutMs: number): typeof fetch {
  return (input, init) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(new Error('timeout')), timeoutMs);
    const upstreamSignal = init?.signal;
    if (upstreamSignal) {
      if (upstreamSignal.aborted) ctl.abort(upstreamSignal.reason);
      else upstreamSignal.addEventListener('abort', () => ctl.abort(upstreamSignal.reason), { once: true });
    }
    return fetch(input, { ...init, signal: ctl.signal }).finally(() => clearTimeout(timer));
  };
}
