import { describe, expect, it, vi } from 'vitest';
import { createOllamaClient } from '../../src/ollama/client.js';
import { MODEL } from '../../src/ollama/models.js';
import { wrapOllamaError } from '../../src/ollama/stream.js';

describe('OllamaClient.checkModel', () => {
  it('returns void when the model is present', async () => {
    const show = vi.fn().mockResolvedValue({
      model_info: {},
      details: { family: 'gemma4' },
    });
    const client = createOllamaClient({ ollama: { show } as never, host: 'http://x', timeoutMs: 1000 });
    await expect(client.checkModel()).resolves.toBeUndefined();
    expect(show).toHaveBeenCalledWith({ model: MODEL });
  });

  it('throws MODEL_MISSING with npm run setup hint when /api/show 404s', async () => {
    const show = vi.fn().mockRejectedValue(
      new Error("model 'gemma4:e4b' not found"),
    );
    const client = createOllamaClient({ ollama: { show } as never, host: 'http://x', timeoutMs: 1000 });
    await expect(client.checkModel()).rejects.toMatchObject({
      code: 'MODEL_MISSING',
    });
    await expect(client.checkModel()).rejects.toThrow(/npm run setup/);
  });

  it('throws OLLAMA_UNREACHABLE when the server refuses connections', async () => {
    const show = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const client = createOllamaClient({ ollama: { show } as never, host: 'http://x', timeoutMs: 1000 });
    await expect(client.checkModel()).rejects.toMatchObject({
      code: 'OLLAMA_UNREACHABLE',
    });
  });
});

describe('OllamaClient.chatOnce', () => {
  it('returns the message content of a non-streaming response', async () => {
    const chat = vi.fn().mockResolvedValue({
      message: { role: 'assistant', content: '{"agentsToRun":[],"reasoning":""}' },
    });
    const client = createOllamaClient({ ollama: { chat } as never, host: 'http://x', timeoutMs: 1000 });
    const out = await client.chatOnce({
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      format: 'json',
    });
    expect(out.content).toBe('{"agentsToRun":[],"reasoning":""}');
    expect(chat).toHaveBeenCalledWith(
      expect.objectContaining({
        model: MODEL,
        format: 'json',
        stream: false,
      }),
    );
  });

  it('rejects when an images field is attached to a message (R12 MUST NOT)', async () => {
    const chat = vi.fn();
    const client = createOllamaClient({ ollama: { chat } as never, host: 'http://x', timeoutMs: 1000 });
    await expect(
      client.chatOnce({
        system: 'sys',
        // R12: a message that smuggles images via the wire shape must be rejected
        // even though our domain Message type does not declare an `images` field.
        messages: [{ role: 'user', content: 'hi', images: ['png-base64'] } as never],
      }),
    ).rejects.toThrow(/images/);
    expect(chat).not.toHaveBeenCalled();
  });

  it('rejects with OLLAMA_TIMEOUT when ollama.chat does not resolve before timeoutMs (PR4-B Defect B)', async () => {
    // Simulates ollama-js v0.6.3 dropping args.signal on the non-streaming path:
    // the underlying chat never settles, so chatOnce must enforce its own ceiling.
    const chat = vi.fn().mockImplementation(
      () => new Promise(() => undefined),
    );
    const client = createOllamaClient({
      ollama: { chat } as never,
      host: 'http://x',
      timeoutMs: 20,
    });
    await expect(
      client.chatOnce({
        system: 'sys',
        messages: [{ role: 'user', content: 'hi' }],
        format: 'json',
      }),
    ).rejects.toMatchObject({ code: 'OLLAMA_TIMEOUT' });
    expect(chat).toHaveBeenCalledTimes(1);
  });
});

describe('wrapOllamaError', () => {
  it('tags ECONNREFUSED as OLLAMA_UNREACHABLE', () => {
    const e = wrapOllamaError(new Error('ECONNREFUSED 127.0.0.1:11434'));
    expect(e.code).toBe('OLLAMA_UNREACHABLE');
  });
  it('tags 404 model-not-found as MODEL_MISSING', () => {
    const e = wrapOllamaError(new Error("model 'gemma4:e4b' not found, status 404"));
    expect(e.code).toBe('MODEL_MISSING');
  });
  it('tags unknown errors as OLLAMA_ERROR', () => {
    const e = wrapOllamaError(new Error('something else'));
    expect(e.code).toBe('OLLAMA_ERROR');
  });
});
