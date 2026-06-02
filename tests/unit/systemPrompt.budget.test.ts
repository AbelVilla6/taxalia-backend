import { describe, expect, it } from 'vitest';
import { assembleSystemPrompt, SystemPromptTooLargeError } from '../../src/dispatch/systemPrompt.js';

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
});
