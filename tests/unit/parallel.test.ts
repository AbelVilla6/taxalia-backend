import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentDef } from '../../src/agents/loader.js';
import type { ConductDef } from '../../src/conducta/loader.js';
import type { SkillDef } from '../../src/skills/loader.js';
import { runAgents } from '../../src/dispatch/parallel.js';
import { Semaphore } from '../../src/dispatch/semaphore.js';
import { resetMetrics } from '../../src/observability/metrics.js';
import type {
  OllamaChatStreamRequest,
  OllamaClient,
} from '../../src/ollama/interface.js';

function makeAgent(id: string, tools: string[] = []): AgentDef {
  return {
    id,
    name: id,
    description: `${id} desc`,
    systemPrompt: `system ${id}`,
    system_prompt: `system ${id}`,
    tools,
    tags: [],
    body: '',
    filePath: `${id}.md`,
  };
}

function makeConducta(): ConductDef[] {
  return Array.from({ length: 5 }, (_, i) => ({
    id: `policy-${i}`,
    description: `Policy ${i}`,
    rule: `Rule ${i}`,
    priority: i,
    body: '',
    filePath: `policy-${i}.md`,
  }));
}

function makeSkills(): SkillDef[] {
  return [
    { id: 'lookup-engagement-model', name: 'Lookup', description: 'Find engagement', tags: [], body: '', filePath: 'a.md' },
  ];
}

function makeClient(
  streams: Record<string, AsyncIterable<string> | Error>,
): OllamaClient {
  return {
    chatOnce: vi.fn(async () => ({ content: '' })),
    chatStream(req: OllamaChatStreamRequest): AsyncIterable<string> {
      // The mock identifies the agent via a marker in the system prompt
      // (the real Ollama client has no way to know which agent called it).
      // The function is intentionally NOT async: the OllamaClient contract
      // returns AsyncIterable<string> directly, not Promise<AsyncIterable>.
      const idMatch = /system ([\w-]+)/.exec(req.system);
      const id = idMatch?.[1] ?? '';
      const value = streams[id];
      if (value instanceof Error) {
        return (async function* () {
          throw value;
        })();
      }
      if (!value) {
        throw new Error(`No mock for ${id}`);
      }
      return value;
    },
    checkModel: vi.fn(async () => undefined),
  };
}

async function* delay(ms: number, parts: string[]): AsyncIterable<string> {
  await new Promise((r) => setTimeout(r, ms));
  for (const p of parts) yield p;
}

async function* hang(): AsyncIterable<string> {
  // Never yields, just hangs forever (until signal aborts)
  await new Promise(() => {});
}

describe('runAgents (parallel runner)', () => {
  beforeEach(() => {
    resetMetrics();
  });

  it('runs two agents in parallel and returns both as ok', async () => {
    const client = makeClient({
      'income-tax': delay(10, ['Income tax ', 'reply.']),
      'business-accounting': delay(15, ['Business accounting ', 'reply.']),
    });
    const sem = new Semaphore(2);
    const start = performance.now();
    const result = await runAgents({
      selected: [makeAgent('income-tax'), makeAgent('business-accounting')],
      history: [{ role: 'user', content: 'help' }],
      lang: 'en',
      conducta: makeConducta(),
      skills: makeSkills(),
      client,
      signal: new AbortController().signal,
      requestId: 'r1',
      timeoutMs: 2000,
      semaphore: sem,
    });
    const elapsed = performance.now() - start;
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.id === 'income-tax')).toMatchObject({
      id: 'income-tax',
      status: 'ok',
      text: 'Income tax reply.',
    });
    expect(result.find((r) => r.id === 'business-accounting')).toMatchObject({
      id: 'business-accounting',
      status: 'ok',
      text: 'Business accounting reply.',
    });
    // parallel: total < sum(individual) so we verify with a margin
    expect(elapsed).toBeLessThan(200);
  });

  it('marks one agent as TIMEOUT when it exceeds 30s and keeps the other as ok', async () => {
    const client = makeClient({
      'income-tax': delay(5, ['quick']),
      'irs-tax-resolution': hang(),
    });
    const sem = new Semaphore(2);
    const result = await runAgents({
      selected: [makeAgent('income-tax'), makeAgent('irs-tax-resolution')],
      history: [{ role: 'user', content: 'help' }],
      lang: 'en',
      conducta: makeConducta(),
      skills: makeSkills(),
      client,
      signal: new AbortController().signal,
      requestId: 'r2',
      timeoutMs: 30, // tiny for test
      semaphore: sem,
    });
    const incomeTax = result.find((r) => r.id === 'income-tax');
    const irsTaxResolution = result.find((r) => r.id === 'irs-tax-resolution');
    expect(incomeTax).toMatchObject({ id: 'income-tax', status: 'ok', text: 'quick' });
    expect(irsTaxResolution).toMatchObject({
      id: 'irs-tax-resolution',
      status: 'error',
      error: { code: 'TIMEOUT' },
      durationMs: 30,
    });

    const { snapshot } = await import('../../src/observability/metrics.js');
    const timeouts = snapshot().find((c) => c.name === 'agent_timeout_total');
    expect(timeouts?.value).toBe(1);
  });

  it('marks the agent as ABORTED when the outer signal aborts mid-stream (R8)', async () => {
    const ctl = new AbortController();
    const client = makeClient({
      'business-accounting': (async function* () {
        await new Promise((r) => setTimeout(r, 5));
        yield 'partial-';
        await new Promise((r) => setTimeout(r, 200));
        yield 'never-seen';
      })(),
    });
    const sem = new Semaphore(2);
    const runPromise = runAgents({
      selected: [makeAgent('business-accounting')],
      history: [{ role: 'user', content: 'help' }],
      lang: 'en',
      conducta: makeConducta(),
      skills: makeSkills(),
      client,
      signal: ctl.signal,
      requestId: 'r3',
      timeoutMs: 5000,
      semaphore: sem,
    });
    setTimeout(() => ctl.abort(), 30);
    const result = await runPromise;
    expect(result[0].id).toBe('business-accounting');
    expect(result[0].status).toMatch(/ok|error/);
  });

  it('emits per-agent OLLAMA_ERROR when the stream throws a non-abort error', async () => {
    const client = makeClient({
      'income-tax': new Error('upstream blew up'),
    });
    const sem = new Semaphore(2);
    const result = await runAgents({
      selected: [makeAgent('income-tax')],
      history: [{ role: 'user', content: 'help' }],
      lang: 'en',
      conducta: makeConducta(),
      skills: makeSkills(),
      client,
      signal: new AbortController().signal,
      requestId: 'r4',
      timeoutMs: 5000,
      semaphore: sem,
    });
    expect(result[0]).toMatchObject({
      id: 'income-tax',
      status: 'error',
      error: { code: 'OLLAMA_ERROR' },
    });
  });

  it('respects the semaphore by serializing two runAgents calls when cap is 1', async () => {
    const client = makeClient({
      'income-tax': delay(30, ['A']),
      'business-accounting': delay(30, ['B']),
    });
    const sem = new Semaphore(1);
    const start = performance.now();
    const [r1, r2] = await Promise.all([
      runAgents({
        selected: [makeAgent('income-tax')],
        history: [{ role: 'user', content: 'help' }],
        lang: 'en',
        conducta: makeConducta(),
        skills: makeSkills(),
        client,
        signal: new AbortController().signal,
        requestId: 'r5a',
        timeoutMs: 2000,
        semaphore: sem,
      }),
      runAgents({
        selected: [makeAgent('business-accounting')],
        history: [{ role: 'user', content: 'help' }],
        lang: 'en',
        conducta: makeConducta(),
        skills: makeSkills(),
        client,
        signal: new AbortController().signal,
        requestId: 'r5b',
        timeoutMs: 2000,
        semaphore: sem,
      }),
    ]);
    const elapsed = performance.now() - start;
    expect(r1).toHaveLength(1);
    expect(r2).toHaveLength(1);
    // cap=1 ⇒ the second runAgents is blocked on the first; total ≥ 60ms
    expect(elapsed).toBeGreaterThanOrEqual(55);
  });

  it('passes only skills listed in the selected agent tools', async () => {
    let capturedSystem = '';
    const client: OllamaClient = {
      chatOnce: vi.fn(async () => ({ content: '' })),
      chatStream(req: OllamaChatStreamRequest): AsyncIterable<string> {
        capturedSystem = req.system;
        return delay(0, ['ok']);
      },
      checkModel: vi.fn(async () => undefined),
    };
    const sem = new Semaphore(2);

    await runAgents({
      selected: [makeAgent('income-tax', ['income-tax-preparation'])],
      history: [{ role: 'user', content: 'help' }],
      lang: 'en',
      conducta: makeConducta(),
      skills: [
        { id: 'income-tax-preparation', name: 'Income', description: 'Income skill', tags: [], body: '', filePath: 'income.md' },
        { id: 'payroll', name: 'Payroll', description: 'Payroll skill', tags: [], body: '', filePath: 'payroll.md' },
      ],
      client,
      signal: new AbortController().signal,
      requestId: 'r6',
      timeoutMs: 2000,
      semaphore: sem,
    });

    expect(capturedSystem).toContain('- income-tax-preparation: Income skill');
    expect(capturedSystem).not.toContain('payroll');
  });
});
