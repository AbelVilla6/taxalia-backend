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

const AGENTS = [
  makeAgent('income-tax', 'Income tax services'),
  makeAgent('business-accounting', 'Business accounting services'),
  makeAgent('irs-tax-resolution', 'IRS tax resolution services'),
];

const FIXTURES: ReadonlyArray<{ userMessage: string; expected: string[] }> = [
  { userMessage: 'Tell me about your income tax services', expected: ['income-tax'] },
  { userMessage: 'Tell me about your business accounting services', expected: ['business-accounting'] },
  { userMessage: 'Tell me about your IRS tax resolution services', expected: ['irs-tax-resolution'] },
  { userMessage: 'Tell me about your services', expected: [] },
  { userMessage: 'hola, qué hacen?', expected: [] },
  { userMessage: 'Cuéntame sobre sus servicios de impuestos sobre la renta', expected: ['income-tax'] },
  { userMessage: 'How do I plan my taxes?', expected: ['income-tax'] },
  { userMessage: 'I need payroll and tax return help', expected: ['income-tax', 'business-accounting'] },
  { userMessage: 'Could you help me with bookkeeping?', expected: ['business-accounting'] },
  { userMessage: 'Random small talk, hi there', expected: [] },
  { userMessage: 'I want to discuss an investment opportunity', expected: [] },
  { userMessage: 'Necesito ayuda con FBAR', expected: ['income-tax'] },
  { userMessage: 'Looking for business accounting and payroll guidance', expected: ['business-accounting'] },
  { userMessage: 'I received an IRS notice and owe back taxes', expected: ['irs-tax-resolution'] },
  { userMessage: 'Tell me about your pricing', expected: [] },
  { userMessage: 'I would like corporation tax preparation', expected: ['business-accounting'] },
  { userMessage: 'What does Taxalia do for expat tax clients?', expected: ['income-tax'] },
  { userMessage: 'I need IRS penalty help', expected: ['irs-tax-resolution'] },
  { userMessage: 'What is your address and phone?', expected: [] },
  { userMessage: 'Do you support small business accounting?', expected: ['business-accounting'] },
];

describe('orchestrator.route (mocked Ollama client)', () => {
  beforeEach(() => {
    resetMetrics();
  });

  it('returns the parsed decision from a JSON response (happy path)', async () => {
    const client = makeClient(() => ({
      content: JSON.stringify({
        agentsToRun: ['income-tax'],
        reasoning: 'User asked for income tax.',
      }),
    }));

    const decision = await route({
      userMessage: 'Tell me about your income tax services',
      agents: AGENTS,
      lang: 'en',
      client,
      requestId: 'req-1',
    });
    expect(decision.agentsToRun).toEqual(['income-tax']);
    expect(decision.reasoning).toBe('User asked for income tax.');
  });

  it('drops unknown agent ids from a JSON response (R3)', async () => {
    const warn = vi.fn();
    const client = makeClient(() => ({
      content: JSON.stringify({
        agentsToRun: ['income-tax', 'mystery-agent', 'business-accounting'],
        reasoning: 'mix',
      }),
    }));
    const decision = await route({
      userMessage: 'help me',
      agents: AGENTS,
      lang: 'en',
      client,
      requestId: 'req-2',
      warn,
    });
    expect(decision.agentsToRun.sort()).toEqual(['business-accounting', 'income-tax']);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/mystery-agent/));
  });

  it('returns empty decision and increments counter on parse failure (R2)', async () => {
    const client = makeClient(() => ({ content: 'not json at all' }));
    const decision = await route({
      userMessage: 'help me',
      agents: AGENTS,
      lang: 'en',
      client,
      requestId: 'req-3',
    });
    expect(decision).toEqual({ agentsToRun: [], reasoning: '' });

    const { snapshot } = await import('../../src/observability/metrics.js');
    const parseErr = snapshot().find((c) => c.name === 'orchestrator_parse_error_total');
    expect(parseErr?.value).toBe(1);
  });

  it('increments dispatch_orchestrator_calls_total once per call (R9)', async () => {
    const client = makeClient(() => ({ content: '{"agentsToRun":[],"reasoning":""}' }));
    await route({ userMessage: 'hi', agents: AGENTS, lang: 'en', client, requestId: 'r1' });
    await route({ userMessage: 'hi', agents: AGENTS, lang: 'en', client, requestId: 'r2' });
    await route({ userMessage: 'hi', agents: AGENTS, lang: 'en', client, requestId: 'r3' });

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

    let parsed = 0;
    for (const f of FIXTURES) {
      const decision = await route({
        userMessage: f.userMessage,
        agents: AGENTS,
        lang: 'en',
        client,
        requestId: `req-${parsed}`,
      });
      if (decision.agentsToRun.sort().join(',') === [...f.expected].sort().join(',')) {
        parsed += 1;
      }
    }
    expect(parsed).toBe(20);
  });

  it('enforces the configured timeout via Promise.race and falls back to EMPTY_DECISION', async () => {
    const warn = vi.fn();
    const client = makeClient(
      () => new Promise<OllamaChatResponse>(() => {}),
    );

    const start = performance.now();
    const decision = await route({
      userMessage: 'help me',
      agents: AGENTS,
      lang: 'en',
      client,
      requestId: 'req-timeout',
      warn,
      timeoutMs: 50,
    });
    const elapsed = performance.now() - start;

    expect(decision).toEqual({ agentsToRun: [], reasoning: '' });
    expect(elapsed).toBeLessThan(1000);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/orchestrator:timeout/));

    const { snapshot } = await import('../../src/observability/metrics.js');
    const parseErr = snapshot().find((c) => c.name === 'orchestrator_parse_error_total');
    expect(parseErr?.value).toBe(1);
  });

  it('does not re-throw ORCHESTRATOR_TIMEOUT (only OLLAMA/MODEL errors propagate)', async () => {
    const client = makeClient(
      () => new Promise<OllamaChatResponse>(() => {}),
    );

    const decision = await route({
      userMessage: 'help me',
      agents: AGENTS,
      lang: 'en',
      client,
      requestId: 'req-timeout-no-rethrow',
      timeoutMs: 25,
    });
    expect(decision.agentsToRun).toEqual([]);
  });
});

describe('orchestrator.keywordFallback (pure)', () => {
  const agents = AGENTS.map((agent) => ({ id: agent.id }));

  it('returns [] for pure small talk', () => {
    expect(keywordFallback('hi there', agents)).toEqual([]);
    expect(keywordFallback('hola', agents)).toEqual([]);
  });

  it('routes frontend welcome option messages to matching service agents', () => {
    expect(keywordFallback('Tell me about your income tax services', agents)).toEqual(['income-tax']);
    expect(keywordFallback('Tell me about your business accounting services', agents)).toEqual(['business-accounting']);
    expect(keywordFallback('Tell me about your IRS tax resolution services', agents)).toEqual(['irs-tax-resolution']);
    expect(keywordFallback('Cuéntame sobre sus servicios de contabilidad empresarial', agents)).toEqual(['business-accounting']);
  });

  it('routes income tax terms to the income tax agent', () => {
    expect(keywordFallback('How do I plan my taxes?', agents)).toEqual(['income-tax']);
    expect(keywordFallback('Necesito ayuda con FBAR', agents)).toEqual(['income-tax']);
  });

  it('routes accounting terms to the business accounting agent', () => {
    expect(keywordFallback('I need payroll support', agents)).toEqual(['business-accounting']);
    expect(keywordFallback('Necesito contabilidad empresarial', agents)).toEqual(['business-accounting']);
  });

  it('routes IRS terms to the IRS tax resolution agent', () => {
    expect(keywordFallback('I received an IRS notice', agents)).toEqual(['irs-tax-resolution']);
    expect(keywordFallback('Tengo una deuda con el IRS', agents)).toEqual(['irs-tax-resolution']);
  });

  it('routes multi-service prompts to multiple agents', () => {
    const result = keywordFallback('I need payroll and tax return help', agents);
    expect(result).toContain('income-tax');
    expect(result).toContain('business-accounting');
  });

  it('drops unknown agent ids from the keyword table', () => {
    const limited = [{ id: 'income-tax' }];
    expect(keywordFallback('I need payroll and tax return help', limited)).toEqual(['income-tax']);
  });

  it('is case-insensitive', () => {
    expect(keywordFallback('IRS NOTICE', agents)).toEqual(['irs-tax-resolution']);
  });
});

describe('orchestrator.route keyword-fallback safety net', () => {
  beforeEach(() => {
    resetMetrics();
  });

  it('routes an income tax prompt via keyword fallback when the LLM returns []', async () => {
    const warn = vi.fn();
    const client = makeClient(() => ({
      content: JSON.stringify({ agentsToRun: [], reasoning: 'no idea' }),
    }));

    const decision = await route({
      userMessage: 'How do I plan my taxes?',
      agents: AGENTS,
      lang: 'en',
      client,
      requestId: 'req-fb-1',
      warn,
    });
    expect(decision.agentsToRun).toEqual(['income-tax']);
    expect(decision.reasoning).toMatch(/keyword fallback/);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/orchestrator:keyword-fallback.*income-tax/));

    const { snapshot } = await import('../../src/observability/metrics.js');
    const fb = snapshot().find((c) => c.name === 'dispatch_keyword_fallback_total');
    expect(fb?.value).toBe(1);
  });

  it('routes an IRS prompt via keyword fallback when the LLM returns []', async () => {
    const client = makeClient(() => ({
      content: JSON.stringify({ agentsToRun: [], reasoning: '' }),
    }));

    const decision = await route({
      userMessage: 'I received an IRS notice',
      agents: AGENTS,
      lang: 'en',
      client,
      requestId: 'req-fb-2',
    });
    expect(decision.agentsToRun).toEqual(['irs-tax-resolution']);
  });

  it('does NOT invoke the fallback for genuine small talk', async () => {
    const warn = vi.fn();
    const client = makeClient(() => ({
      content: JSON.stringify({ agentsToRun: [], reasoning: 'small talk' }),
    }));

    const decision = await route({
      userMessage: 'hola, buen día',
      agents: AGENTS,
      lang: 'es',
      client,
      requestId: 'req-fb-3',
      warn,
    });
    expect(decision.agentsToRun).toEqual([]);
    expect(warn).not.toHaveBeenCalledWith(expect.stringMatching(/orchestrator:keyword-fallback/));
  });

  it('preserves the LLM decision when the LLM already picked an agent', async () => {
    const client = makeClient(() => ({
      content: JSON.stringify({
        agentsToRun: ['business-accounting'],
        reasoning: 'user asked for accounting',
      }),
    }));

    const decision = await route({
      userMessage: 'I need payroll help',
      agents: AGENTS,
      lang: 'en',
      client,
      requestId: 'req-fb-4',
    });
    expect(decision.agentsToRun).toEqual(['business-accounting']);
    expect(decision.reasoning).toBe('user asked for accounting');
  });
});
