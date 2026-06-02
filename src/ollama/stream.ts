import type { ChatResponse, Message, Ollama } from 'ollama';
import type { OllamaChatStreamRequest, OllamaClient } from './interface.js';

export type StreamAdapter = Pick<OllamaClient, 'chatStream'>;

export function createOllamaStreamAdapter(ollama: Ollama): StreamAdapter {
  return {
    async *chatStream({
      system,
      messages,
      signal,
    }: OllamaChatStreamRequest): AsyncIterable<string> {
      const ollamaMessages: Message[] = [
        { role: 'system', content: system },
        ...messages,
      ];

      let iterator: AsyncGenerator<ChatResponse, void, unknown>;
      try {
        const response = await ollama.chat({
          model: 'gemma4:e4b',
          messages: ollamaMessages,
          stream: true,
        });
        iterator = (async function* () {
          for await (const part of response as unknown as AsyncIterable<ChatResponse>) {
            yield part;
          }
        })();

        if (signal.aborted) {
          (response as unknown as { abort: () => void }).abort();
          return;
        }
        signal.addEventListener(
          'abort',
          () => {
            (response as unknown as { abort: () => void }).abort();
          },
          { once: true },
        );
      } catch (err) {
        throw wrapOllamaError(err);
      }

      try {
        for await (const part of iterator) {
          if (signal.aborted) return;
          const content = part?.message?.content;
          if (typeof content === 'string' && content.length > 0) {
            yield content;
          }
        }
      } catch (err) {
        if (signal.aborted) return;
        throw wrapOllamaError(err);
      }
    },
  };
}

export function wrapOllamaError(err: unknown): Error & { code: string } {
  const base = err instanceof Error ? err : new Error(String(err));
  const message = base.message ?? '';

  if (
    /ECONNREFUSED|fetch failed|connect ECONNREFUSED|ENOTFOUND|socket hang up/i.test(
      message,
    )
  ) {
    const wrapped = new Error(
      `Ollama is unreachable: ${message}. Run 'npm run setup'.`,
    ) as Error & { code: string };
    wrapped.code = 'OLLAMA_UNREACHABLE';
    wrapped.cause = base;
    return wrapped;
  }
  if (/model ['"]?gemma4:e4b['"]? not found|404/i.test(message)) {
    const wrapped = new Error(
      `Model not found: ${message}. Run 'npm run setup'.`,
    ) as Error & { code: string };
    wrapped.code = 'MODEL_MISSING';
    wrapped.cause = base;
    return wrapped;
  }
  const wrapped = new Error(message || 'Ollama call failed.') as Error & {
    code: string;
  };
  wrapped.code = 'OLLAMA_ERROR';
  wrapped.cause = base;
  return wrapped;
}
