import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentResult } from '../../src/chat/schemas.js';
import { synthesize } from '../../src/dispatch/synthesizer.js';
import { resetMetrics } from '../../src/observability/metrics.js';
import type { OllamaClient } from '../../src/ollama/interface.js';

function okResult(id: string, text: string): AgentResult {
  return { id, status: 'ok', text, durationMs: 10 };
}

function errResult(id: string, code: string): AgentResult {
  return { id, status: 'error', error: { code }, durationMs: 30 };
}

function makeClient(stream: AsyncIterable<string> | Error): OllamaClient {
  return {
    chatOnce: vi.fn(async () => ({ content: '' })),
    chatStream() {
      if (stream instanceof Error) {
        return (async function* () {
          throw stream;
        })();
      }
      return stream;
    },
    checkModel: vi.fn(async () => undefined),
  };
}

describe('synthesize (synthesizer)', () => {
  beforeEach(() => {
    resetMetrics();
  });

  it('skips when no agents were selected (length < 2)', async () => {
    const client = makeClient((async function* () {
      yield 'should not happen';
    })());
    const result = await synthesize({
      userMessage: 'help',
      agentResults: [],
      lang: 'en',
      client,
    });
    expect(result).toBeNull();
  });

  it('skips when only one agent was selected (length < 2)', async () => {
    const client = makeClient((async function* () {
      yield 'should not happen';
    })());
    const result = await synthesize({
      userMessage: 'help',
      agentResults: [okResult('advisory', 'A reply')],
      lang: 'en',
      client,
    });
    expect(result).toBeNull();
  });

  it('skips when all selected agents errored', async () => {
    const client = makeClient((async function* () {
      yield 'should not happen';
    })());
    const result = await synthesize({
      userMessage: 'help',
      agentResults: [errResult('advisory', 'TIMEOUT'), errResult('valuation', 'OLLAMA_ERROR')],
      lang: 'en',
      client,
    });
    expect(result).toBeNull();
  });

  it('synthesizes when 2+ agents succeeded, joining the stream into a final string', async () => {
    const synthStream = (async function* () {
      yield 'Merged ';
      yield 'reply.';
    })();
    const client = makeClient(synthStream);

    const result = await synthesize({
      userMessage: 'help me with both',
      agentResults: [
        okResult('advisory', 'A first take'),
        okResult('valuation', 'V second take'),
      ],
      lang: 'en',
      client,
    });

    expect(result).toEqual({ text: 'Merged reply.' });
  });

  it('synthesizes with only the successful outputs when some agents errored', async () => {
    const synthStream = (async function* () {
      yield 'Partial ';
      yield 'merge.';
    })();
    const client = makeClient(synthStream);

    const result = await synthesize({
      userMessage: 'help',
      agentResults: [
        okResult('advisory', 'A reply'),
        errResult('valuation', 'TIMEOUT'),
      ],
      lang: 'en',
      client,
    });

    expect(result).toEqual({ text: 'Partial merge.' });
  });

  it('skips when the stream from Ollama is a thrown error (defensive)', async () => {
    const client = makeClient(new Error('synth upstream blew up'));
    await expect(
      synthesize({
        userMessage: 'help',
        agentResults: [okResult('advisory', 'A'), okResult('valuation', 'V')],
        lang: 'en',
        client,
      }),
    ).rejects.toThrow(/synth upstream blew up/);
  });
});
