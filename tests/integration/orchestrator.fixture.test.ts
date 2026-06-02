import { describe, expect, it } from 'vitest';
import { route } from '../../src/dispatch/orchestrator.js';
import { resetMetrics } from '../../src/observability/metrics.js';
import { createOllamaClient } from '../../src/ollama/client.js';
import { createArtifactRegistry } from '../../src/loaders/registry.js';
import type { AgentDef } from '../../src/agents/loader.js';

const LIVE = process.env.RUN_LIVE_OLLAMA_TESTS === '1';

const FIXTURES: ReadonlyArray<{ userMessage: string }> = [
  { userMessage: 'I need an advisory quote' },
  { userMessage: 'Can you help me value my company?' },
  { userMessage: 'I need help with my finances' },
  { userMessage: 'Tell me about your services' },
  { userMessage: 'hola, qué hacen?' },
  { userMessage: 'Quiero entender valoración y finanzas' },
  { userMessage: 'How do I plan my taxes?' },
  { userMessage: 'I have an advisory question and need a valuation' },
  { userMessage: 'Could you help me with financial planning?' },
  { userMessage: 'Random small talk, hi there' },
  { userMessage: 'I want to discuss an investment opportunity' },
  { userMessage: 'Necesito un análisis de valoración' },
  { userMessage: 'Looking for advisory services and financial guidance' },
  { userMessage: 'I need a quote for advisory and valuation' },
  { userMessage: 'Tell me about your pricing' },
  { userMessage: 'I would like a financial review' },
  { userMessage: 'What does Taxalia do for advisory clients?' },
  { userMessage: 'I want to start a company valuation' },
  { userMessage: 'What is your address and phone?' },
  { userMessage: 'Schedule me with an advisor' },
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
