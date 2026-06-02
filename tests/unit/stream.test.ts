import { describe, expect, it, vi } from 'vitest';
import type { ChatRequest, ChatResponse, Message, Ollama } from 'ollama';
import { createOllamaStreamAdapter } from '../../src/ollama/stream.js';

function makeMessage(content: string): Message {
  return { role: 'assistant', content };
}

function makeChunk(content: string, done = false): ChatResponse {
  return {
    model: 'gemma4:e4b',
    created_at: new Date(),
    message: makeMessage(content),
    done,
    done_reason: done ? 'stop' : '',
    total_duration: 0,
    load_duration: 0,
    prompt_eval_count: 0,
    prompt_eval_duration: 0,
    eval_count: 0,
    eval_duration: 0,
  };
}

function makeStubOllama(chunks: ChatResponse[]): Ollama {
  const stub = {
    chat(req: ChatRequest & { stream: true }) {
      const controller = new AbortController();
      const iter = (async function* () {
        for (const chunk of chunks) {
          yield chunk;
        }
      })();
      return Promise.resolve({
        abort: () => controller.abort(),
        [Symbol.asyncIterator]: () => iter,
      });
    },
  } as unknown as Ollama;
  return stub;
}

describe('chatStream (ollama stream adapter)', () => {
  it('filters out empty-delta parts and yields the rest in order', async () => {
    const stub = makeStubOllama([
      makeChunk(''),
      makeChunk('Hello'),
      makeChunk(''),
      makeChunk(', '),
      makeChunk('world'),
      makeChunk(''),
      makeChunk('', true),
    ]);
    const adapter = createOllamaStreamAdapter(stub);

    const collected: string[] = [];
    for await (const delta of adapter.chatStream({
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      signal: new AbortController().signal,
    })) {
      collected.push(delta);
    }

    expect(collected).toEqual(['Hello', ', ', 'world']);
  });

  it('invokes the underlying abort() within 500ms of the signal aborting', async () => {
    const abort = vi.fn();
    const stub = {
      chat: () =>
        Promise.resolve({
          abort,
          [Symbol.asyncIterator]: () => {
            const iter = (async function* () {
              // simulate Ollama yielding chunks slowly
              while (true) {
                yield makeChunk('x');
                await new Promise((r) => setTimeout(r, 50));
              }
            })();
            return iter;
          },
        }),
    } as unknown as Ollama;
    const adapter = createOllamaStreamAdapter(stub);
    const controller = new AbortController();
    const start = performance.now();
    const consumer = (async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _delta of adapter.chatStream({
        system: 'sys',
        messages: [{ role: 'user', content: 'hi' }],
        signal: controller.signal,
      })) {
        // keep consuming until abort propagates
      }
    })();

    setTimeout(() => controller.abort(), 30);
    await consumer;
    const elapsed = performance.now() - start;

    expect(abort).toHaveBeenCalled();
    expect(elapsed).toBeLessThan(500);
  });

  it('throws a tagged error if the underlying Ollama call rejects', async () => {
    const stub = {
      chat: () => Promise.reject(new Error('ECONNREFUSED')),
    } as unknown as Ollama;
    const adapter = createOllamaStreamAdapter(stub);

    await expect(
      (async () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _d of adapter.chatStream({
          system: 'sys',
          messages: [{ role: 'user', content: 'hi' }],
          signal: new AbortController().signal,
        })) {
          // no-op
        }
      })(),
    ).rejects.toThrow(/OLLAMA_UNREACHABLE|ECONNREFUSED/);
  });
});
