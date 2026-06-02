import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentDef } from '../../src/agents/loader.js';
import { keywordFallback, route } from '../../src/dispatch/orchestrator.js';
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
  { userMessage: 'How do I plan my taxes?', expected: ['financial'] },
  { userMessage: 'I have an advisory question and need a valuation', expected: ['advisory', 'valuation'] },
  { userMessage: 'Could you help me with financial planning?', expected: ['financial'] },
  { userMessage: 'Random small talk, hi there', expected: [] },
  { userMessage: 'I want to discuss an investment opportunity', expected: [] },
  { userMessage: 'Necesito un an\u00e1lisis de valoraci\u00f3n', expected: ['valuation'] },
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

describe('orchestrator.keywordFallback (pure)', () => {
  const agents = [
    { id: 'advisory' },
    { id: 'valuation' },
    { id: 'financial' },
  ];

  it('returns [] for pure small talk in English', () => {
    expect(keywordFallback('hi there', agents)).toEqual([]);
    expect(keywordFallback('thanks!', agents)).toEqual([]);
  });

  it('returns [] for pure small talk in Spanish', () => {
    expect(keywordFallback('hola', agents)).toEqual([]);
    expect(keywordFallback('gracias', agents)).toEqual([]);
  });

  it('routes a Spanish valuation prompt to the valuation agent', () => {
    // The prompt intentionally avoids "empresa" / "negocio" so it
    // matches ONLY the valuation agent. Other tests cover the
    // multi-agent fan-out.
    expect(keywordFallback('Necesito un an\u00e1lisis de valoraci\u00f3n', agents)).toEqual([
      'valuation',
    ]);
  });

  it('routes a Spanish valuation+finance prompt to both agents', () => {
    const result = keywordFallback(
      'Quiero entender valoración y finanzas para mi pyme',
      agents,
    );
    expect(result).toContain('valuation');
    expect(result).toContain('financial');
  });

  it('routes "asesor\u00eda" to the advisory agent', () => {
    expect(
      keywordFallback('Necesito una asesor\u00eda contable y fiscal', agents),
    ).toEqual(expect.arrayContaining(['advisory', 'financial']));
  });

  it('routes a tax question to the financial agent', () => {
    expect(keywordFallback('How do I plan my taxes?', agents)).toEqual([
      'financial',
    ]);
  });

  it('routes an English business prompt to advisory + financial', () => {
    const result = keywordFallback(
      'Looking for advisory services and financial guidance',
      agents,
    );
    expect(result).toContain('advisory');
    expect(result).toContain('financial');
  });

  it('drops unknown agent ids from the keyword table', () => {
    const limited = [{ id: 'advisory' }];
    // "valoraci\u00f3n" routes to "valuation" which is NOT in the registry
    // → must NOT appear, and the function must not throw.
    expect(keywordFallback('valoraci\u00f3n de empresa', limited)).toEqual([
      'advisory',
    ]);
  });

  it('is case-insensitive', () => {
    expect(keywordFallback('VALUATION of my company', agents)).toEqual([
      'valuation',
    ]);
    expect(keywordFallback('Asesor\u00eda LEGAL', agents)).toContain('advisory');
  });
});

describe('orchestrator.route keyword-fallback safety net', () => {
  beforeEach(() => {
    resetMetrics();
  });

  it('routes a Spanish valuation prompt via keyword fallback when the LLM returns []', async () => {
    const warn = vi.fn();
    const client = makeClient(() => ({
      content: JSON.stringify({ agentsToRun: [], reasoning: 'no idea' }),
    }));
    const agents = [
      makeAgent('advisory', 'Advisory services'),
      makeAgent('valuation', 'Valuation services'),
      makeAgent('financial', 'Financial services'),
    ];

    const decision = await route({
      userMessage: 'Necesito un an\u00e1lisis de valoraci\u00f3n',
      agents,
      lang: 'es',
      client,
      requestId: 'req-fb-1',
      warn,
    });
    expect(decision.agentsToRun).toEqual(['valuation']);
    expect(decision.reasoning).toMatch(/keyword fallback/);
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/orchestrator:keyword-fallback.*valuation/),
    );

    const { snapshot } = await import('../../src/observability/metrics.js');
    const fb = snapshot().find((c) => c.name === 'dispatch_keyword_fallback_total');
    expect(fb?.value).toBe(1);
  });

  it('routes an English business prompt via keyword fallback when the LLM returns []', async () => {
    const warn = vi.fn();
    const client = makeClient(() => ({
      content: JSON.stringify({ agentsToRun: [], reasoning: '' }),
    }));
    const agents = [
      makeAgent('advisory', 'A'),
      makeAgent('valuation', 'V'),
      makeAgent('financial', 'F'),
    ];

    const decision = await route({
      userMessage: 'I need a quote for advisory and valuation',
      agents,
      lang: 'en',
      client,
      requestId: 'req-fb-2',
      warn,
    });
    expect(decision.agentsToRun.sort()).toEqual(['advisory', 'valuation']);
  });

  it('does NOT invoke the fallback for genuine small talk', async () => {
    const warn = vi.fn();
    const client = makeClient(() => ({
      content: JSON.stringify({ agentsToRun: [], reasoning: 'small talk' }),
    }));
    const agents = [
      makeAgent('advisory', 'A'),
      makeAgent('valuation', 'V'),
    ];

    const decision = await route({
      userMessage: 'hola, buen día',
      agents,
      lang: 'es',
      client,
      requestId: 'req-fb-3',
      warn,
    });
    expect(decision.agentsToRun).toEqual([]);
    expect(warn).not.toHaveBeenCalledWith(
      expect.stringMatching(/orchestrator:keyword-fallback/),
    );
  });

  it('preserves the LLM decision when the LLM already picked an agent (fallback is a safety net only)', async () => {
    const client = makeClient(() => ({
      content: JSON.stringify({
        agentsToRun: ['valuation'],
        reasoning: 'user asked for valuation',
      }),
    }));
    const agents = [
      makeAgent('advisory', 'A'),
      makeAgent('valuation', 'V'),
    ];

    const decision = await route({
      userMessage: 'valoraci\u00f3n de mi empresa',
      agents,
      lang: 'es',
      client,
      requestId: 'req-fb-4',
    });
    expect(decision.agentsToRun).toEqual(['valuation']);
    expect(decision.reasoning).toBe('user asked for valuation');
  });
});
