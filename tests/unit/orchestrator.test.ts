import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentDef } from '../../src/agents/loader.js';
import { route } from '../../src/dispatch/orchestrator.js';
import { resetMetrics } from '../../src/observability/metrics.js';
import type {
  OllamaChatRequest,
  OllamaChatResponse,
  OllamaClient,
} from '../../src/ollama/interface.js';

function makeAgent(id: string, description: string): AgentDef {
  return {
    id,
    name: id,
    description,
    systemPrompt: `prompt for ${id}`,
    system_prompt: `prompt for ${id}`,
    tools: [],
    tags: [],
    body: '',
    filePath: `${id}.md`,
  };
}

function makeClient(responder: (req: OllamaChatRequest) => Promise<OllamaChatResponse> | OllamaChatResponse): OllamaClient {
  return {
    chatOnce: vi.fn(async (req) => responder(req)),
    chatStream: (() => {
      throw new Error('not used in orchestrator tests');
    }) as never,
    checkModel: (() => Promise.resolve()) as never,
  };
}

const FIXTURES: ReadonlyArray<{ userMessage: string; expected: string[] }> = [
  { userMessage: 'I need an advisory quote', expected: ['advisory'] },
  { userMessage: 'Can you help me value my company?', expected: ['valuation'] },
  { userMessage: 'I need help with my finances', expected: ['financial'] },
  { userMessage: 'Tell me about your services', expected: [] },
  { userMessage: 'hola, qué hacen?', expected: [] },
  { userMessage: 'Quiero entender valoración y finanzas', expected: ['valuation', 'financial'] },
  { userMessage: 'How do I plan my taxes?', expected: [] },
  { userMessage: 'I have an advisory question and need a valuation', expected: ['advisory', 'valuation'] },
  { userMessage: 'Could you help me with financial planning?', expected: ['financial'] },
  { userMessage: 'Random small talk, hi there', expected: [] },
  { userMessage: 'I want to discuss an investment opportunity', expected: [] },
  { userMessage: 'Necesito un análisis de valoración', expected: ['valuation'] },
  { userMessage: 'Looking for advisory services and financial guidance', expected: ['advisory', 'financial'] },
  { userMessage: 'I need a quote for advisory and valuation', expected: ['advisory', 'valuation'] },
  { userMessage: 'Tell me about your pricing', expected: [] },
  { userMessage: 'I would like a financial review', expected: ['financial'] },
  { userMessage: 'What does Taxalia do for advisory clients?', expected: ['advisory'] },
  { userMessage: 'I want to start a company valuation', expected: ['valuation'] },
  { userMessage: 'What is your address and phone?', expected: [] },
  { userMessage: 'Schedule me with an advisor', expected: ['advisory'] },
];

describe('orchestrator.route (mocked Ollama client)', () => {
  beforeEach(() => {
    resetMetrics();
  });

  it('returns the parsed decision from a JSON response (happy path)', async () => {
    const client = makeClient(() => ({
      content: JSON.stringify({
        agentsToRun: ['advisory'],
        reasoning: 'User asked for advisory.',
      }),
    }));
    const agents = [
      makeAgent('advisory', 'Advisory services'),
      makeAgent('valuation', 'Valuation services'),
    ];

    const decision = await route({
      userMessage: 'I need an advisory quote',
      agents,
      lang: 'en',
      client,
      requestId: 'req-1',
    });
    expect(decision.agentsToRun).toEqual(['advisory']);
    expect(decision.reasoning).toBe('User asked for advisory.');
  });

  it('drops unknown agent ids from a JSON response (R3)', async () => {
    const warn = vi.fn();
    const client = makeClient(() => ({
      content: JSON.stringify({
        agentsToRun: ['advisory', 'mystery-agent', 'valuation'],
        reasoning: 'mix',
      }),
    }));
    const agents = [makeAgent('advisory', 'A'), makeAgent('valuation', 'V')];
    const decision = await route({
      userMessage: 'help me',
      agents,
      lang: 'en',
      client,
      requestId: 'req-2',
      warn,
    });
    expect(decision.agentsToRun.sort()).toEqual(['advisory', 'valuation']);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/mystery-agent/));
  });

  it('returns empty decision and increments counter on parse failure (R2)', async () => {
    const client = makeClient(() => ({ content: 'not json at all' }));
    const agents = [makeAgent('advisory', 'A')];
    const decision = await route({
      userMessage: 'help me',
      agents,
      lang: 'en',
      client,
      requestId: 'req-3',
    });
    expect(decision).toEqual({ agentsToRun: [], reasoning: '' });

    const { snapshot } = await import('../../src/observability/metrics.js');
    const counters = snapshot();
    const parseErr = counters.find((c) => c.name === 'orchestrator_parse_error_total');
    expect(parseErr?.value).toBe(1);
  });

  it('increments dispatch_orchestrator_calls_total once per call (R9)', async () => {
    const client = makeClient(() => ({ content: '{"agentsToRun":[],"reasoning":""}' }));
    const agents = [makeAgent('advisory', 'A')];
    await route({ userMessage: 'hi', agents, lang: 'en', client, requestId: 'r1' });
    await route({ userMessage: 'hi', agents, lang: 'en', client, requestId: 'r2' });
    await route({ userMessage: 'hi', agents, lang: 'en', client, requestId: 'r3' });

    const { snapshot } = await import('../../src/observability/metrics.js');
    const calls = snapshot().find((c) => c.name === 'dispatch_orchestrator_calls_total');
    expect(calls?.value).toBe(3);
  });

  it('parses 20/20 mock fixtures when the model returns well-formed JSON', async () => {
    const client = makeClient((req) => {
      const message = req.messages[0]?.content ?? '';
      const fixture = FIXTURES.find((f) => message.includes(f.userMessage));
      const expected = fixture?.expected ?? [];
      return { content: JSON.stringify({ agentsToRun: expected, reasoning: 'ok' }) };
    });
    const agents = [
      makeAgent('advisory', 'Advisory'),
      makeAgent('valuation', 'Valuation'),
      makeAgent('financial', 'Financial'),
    ];

    let parsed = 0;
    for (const f of FIXTURES) {
      const decision = await route({
        userMessage: f.userMessage,
        agents,
        lang: 'en',
        client,
        requestId: `req-${parsed}`,
      });
      if (
        Array.isArray(decision.agentsToRun) &&
        decision.agentsToRun.sort().join(',') === [...f.expected].sort().join(',')
      ) {
        parsed += 1;
      }
    }
    expect(parsed).toBeGreaterThanOrEqual(16);
    expect(parsed).toBe(20);
  });

  // PR4-B Defect B: ollama-js v0.6.3 drops the AbortSignal on the
  // non-streaming chat path. The orchestrator MUST still enforce its
  // 10s ceiling independently of ollama-js signal support — the
  // request can be hung by a slow model and the caller must observe
  // a parse-fail/fallback (EMPTY_DECISION) within the budget.
  it('enforces the configured timeout via Promise.race and falls back to EMPTY_DECISION', async () => {
    const warn = vi.fn();
    // chatOnce never resolves (simulates a hung ollama that ignores
    // the AbortSignal because ollama-js drops it on non-streaming).
    const client = makeClient(
      () => new Promise<OllamaChatResponse>(() => {}),
    );
    const agents = [makeAgent('advisory', 'A')];

    const start = performance.now();
    const decision = await route({
      userMessage: 'help me',
      agents,
      lang: 'en',
      client,
      requestId: 'req-timeout',
      warn,
      timeoutMs: 50,
    });
    const elapsed = performance.now() - start;

    expect(decision).toEqual({ agentsToRun: [], reasoning: '' });
    // Promise.race resolution must be observed within the timeout
    // window (with a small margin for scheduler jitter).
    expect(elapsed).toBeLessThan(1000);
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/orchestrator:timeout/),
    );

    const { snapshot } = await import('../../src/observability/metrics.js');
    const parseErr = snapshot().find(
      (c) => c.name === 'orchestrator_parse_error_total',
    );
    expect(parseErr?.value).toBe(1);
  });

  // Defect B companion: when the orchestrator signals timeout it must
  // NOT be mis-classified as OLLAMA_UNREACHABLE / MODEL_MISSING, which
  // would surface as 503 from the chat route instead of a clean
  // fallback to empty agents.
  it('does not re-throw ORCHESTRATOR_TIMEOUT (only OLLAMA/MODEL errors propagate)', async () => {
    const client = makeClient(
      () => new Promise<OllamaChatResponse>(() => {}),
    );
    const agents = [makeAgent('advisory', 'A')];

    const decision = await route({
      userMessage: 'help me',
      agents,
      lang: 'en',
      client,
      requestId: 'req-timeout-no-rethrow',
      timeoutMs: 25,
    });
    expect(decision.agentsToRun).toEqual([]);
  });
});
