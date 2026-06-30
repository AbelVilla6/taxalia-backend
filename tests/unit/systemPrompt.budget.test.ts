import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assembleSystemPrompt, SystemPromptTooLargeError } from '../../src/dispatch/systemPrompt.js';
import { loadAgents } from '../../src/agents/loader.js';
import { loadConducta } from '../../src/conducta/loader.js';
import { loadSkills } from '../../src/skills/loader.js';

// Resolve artifact directories relative to the backend package root so the
// tests work regardless of cwd when Vitest is invoked.
const BACKEND_ROOT = join(new URL('../../', import.meta.url).pathname);
const AGENTS_DIR = join(BACKEND_ROOT, 'src/agents');
const CONDUCTA_DIR = join(BACKEND_ROOT, 'src/conducta');
const SKILLS_DIR = join(BACKEND_ROOT, 'src/skills');

describe('system prompt budget', () => {
  it('throws SystemPromptTooLargeError when the estimate exceeds 1500 tokens', () => {
    const conducta = Array.from({ length: 5 }, (_, index) => ({
      id: `policy-${index}`,
      description: `Policy ${index}`,
      rule: `Rule ${index}`,
      priority: index,
      body: '',
      filePath: `policy-${index}.md`,
    }));

    expect(() =>
      assembleSystemPrompt({
        lang: 'en',
        conducta,
        agent: { systemPrompt: 'Agent prompt' },
        skills: [
          {
            id: 'huge',
            description: 'x'.repeat(6800),
          },
        ],
      }),
    ).toThrow(SystemPromptTooLargeError);
  });

  it.each(['en', 'es'] as const)(
    'real artifacts — financial agent with bookingUrl does not throw (lang: %s)',
    async (lang) => {
      const [agents, conducta, skills] = await Promise.all([
        loadAgents(AGENTS_DIR),
        loadConducta(CONDUCTA_DIR),
        loadSkills(SKILLS_DIR),
      ]);
      const financial = agents.find((agent) => agent.id === 'financial');
      expect(financial).toBeDefined();

      expect(() =>
        assembleSystemPrompt({
          lang,
          conducta,
          agent: { systemPrompt: financial!.systemPrompt },
          skills: skills.map((s) => ({ id: s.id, description: s.description })),
          bookingUrl: 'https://cal.com/taxalia/consulta',
        }),
      ).not.toThrow(SystemPromptTooLargeError);
    },
  );
});
