import { describe, expect, it } from 'vitest';
import { route } from '../../src/dispatch/orchestrator.js';
import { resetMetrics } from '../../src/observability/metrics.js';
import { createOllamaClient } from '../../src/ollama/client.js';
import { createArtifactRegistry } from '../../src/loaders/registry.js';
import type { AgentDef } from '../../src/agents/loader.js';

const LIVE = process.env.RUN_LIVE_OLLAMA_TESTS === '1';

const FIXTURES: ReadonlyArray<{ userMessage: string }> = [
  { userMessage: 'Tell me about your income tax services' },
  { userMessage: 'Tell me about your business accounting services' },
  { userMessage: 'Tell me about your IRS tax resolution services' },
  { userMessage: 'Tell me about your services' },
  { userMessage: 'hola, qué hacen?' },
  { userMessage: 'Cuéntame sobre sus servicios de impuestos sobre la renta' },
  { userMessage: 'How do I plan my taxes?' },
  { userMessage: 'I need payroll and tax return help' },
  { userMessage: 'Could you help me with bookkeeping?' },
  { userMessage: 'Random small talk, hi there' },
  { userMessage: 'I want to discuss an investment opportunity' },
  { userMessage: 'Necesito ayuda con FBAR' },
  { userMessage: 'Looking for business accounting and payroll guidance' },
  { userMessage: 'I received an IRS notice and owe back taxes' },
  { userMessage: 'Tell me about your pricing' },
  { userMessage: 'I would like corporation tax preparation' },
  { userMessage: 'What does Taxalia do for expat tax clients?' },
  { userMessage: 'I need IRS penalty help' },
  { userMessage: 'What is your address and phone?' },
  { userMessage: 'Do you support small business accounting?' },
];

/**
 * Live orchestrator fixture: drives the real orchestrator against
 * `gemma4:e4b` for 20 fixture messages and asserts that at least 16
 * produce a parseable `OrchestratorDecision`. Gated behind
 * `RUN_LIVE_OLLAMA_TESTS=1`.
 */
describe.skipIf(!LIVE)('orchestrator.route live fixture (gemma4:e4b)', () => {
  it('parses ≥ 16/20 fixture decisions from the live model', async () => {
    resetMetrics();
    const env = {
      OLLAMA_HOST: process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434',
    };
    const registry = createArtifactRegistry();
    const snap = await registry.reload();
    const agents: AgentDef[] = snap.agents;
    expect(agents.length).toBeGreaterThan(0);
    const client = createOllamaClient({
      host: env.OLLAMA_HOST,
      timeoutMs: 15_000,
    });

    const known = new Set(agents.map((a) => a.id));
    let parsed = 0;
    for (const f of FIXTURES) {
      const decision = await route({
        userMessage: f.userMessage,
        agents,
        lang: 'en',
        client,
        requestId: `live-${parsed}`,
        timeoutMs: 10_000,
      });
      if (
        Array.isArray(decision.agentsToRun) &&
        decision.agentsToRun.every((id) => known.has(id))
      ) {
        parsed += 1;
      }
    }
    expect(parsed).toBeGreaterThanOrEqual(16);
  }, 60_000 * 4);
});
