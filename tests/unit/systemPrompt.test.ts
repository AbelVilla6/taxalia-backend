import { describe, expect, it } from 'vitest';
import { assembleSystemPrompt } from '../../src/dispatch/systemPrompt.js';
import type { ConductDef } from '../../src/conducta/loader.js';
import type { SkillDef } from '../../src/skills/loader.js';

function conduct(priority: number): ConductDef {
  return {
    id: `policy-${priority}`,
    description: `Policy ${priority}`,
    rule: `Rule ${priority}`,
    priority,
    body: '',
    filePath: `policy-${priority}.md`,
  };
}

const skills: SkillDef[] = [
  { id: 'lookup-engagement-model', name: 'Lookup', description: 'Find engagement model', tags: [], body: '', filePath: 'lookup.md' },
  { id: 'capture-lead', name: 'Capture', description: 'Capture lead context', tags: [], body: '', filePath: 'capture.md' },
];

describe('assembleSystemPrompt', () => {
  it('is byte-identical for repeated calls', () => {
    const input = {
      lang: 'en' as const,
      conducta: [conduct(1), conduct(2), conduct(3), conduct(4), conduct(5)],
      agent: { systemPrompt: 'Agent prompt' },
      skills,
    };
    const first = assembleSystemPrompt(input);
    for (let i = 0; i < 1000; i++) {
      expect(assembleSystemPrompt(input)).toBe(first);
    }
  });

  it('orders conduct by priority and uses the bilingual header', () => {
    const prompt = assembleSystemPrompt({
      lang: 'es',
      conducta: [conduct(3), conduct(1), conduct(5), conduct(2), conduct(4)],
      agent: { systemPrompt: 'Prompt del agente' },
      skills,
    });

    expect(prompt).toContain('## Políticas de conducta');
    expect(prompt.indexOf('Rule 1')).toBeLessThan(prompt.indexOf('Rule 2'));
    expect(prompt.indexOf('Rule 2')).toBeLessThan(prompt.indexOf('Rule 3'));
    expect(prompt).toContain('- lookup-engagement-model: Find engagement model');
  });
});
