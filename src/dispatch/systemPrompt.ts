import type { AgentDef } from '../agents/loader.js';
import type { ConductDef } from '../conducta/loader.js';
import type { Lang } from '../chat/schemas.js';
import type { SkillDef } from '../skills/loader.js';
import { tokenEstimate } from '../ollama/models.js';

const MAX_SYSTEM_PROMPT_TOKENS = 1500;
const CONDUCT_SEPARATOR = '\n\n---\n\n';

const BASE_IDENTITY: Record<Lang, string> = {
  en: 'You are Lexi, the AI assistant for Taxalia. Answer clearly, stay within Taxalia services, and hand off to a human when the user needs personalized advice.',
  es: 'Eres Lexi, la asistente de IA de Taxalia. Respondé con claridad, mantenete dentro de los servicios de Taxalia y derivá a una persona cuando el usuario necesite asesoramiento personalizado.',
};

const CONDUCT_HEADER: Record<Lang, string> = {
  en: '## Conduct policies',
  es: '## Políticas de conducta',
};

export class SystemPromptTooLargeError extends Error {
  constructor(public readonly tokenCount: number) {
    super(`System prompt is too large: ${tokenCount} tokens estimated, max ${MAX_SYSTEM_PROMPT_TOKENS}.`);
    this.name = 'SystemPromptTooLargeError';
  }
}

export function tokenCount(prompt: string): number {
  return tokenEstimate(prompt);
}

export function assembleSystemPrompt(input: {
  lang: Lang;
  conducta: ConductDef[];
  agent: Pick<AgentDef, 'systemPrompt'>;
  skills: Array<Pick<SkillDef, 'id' | 'description'>>;
}): string {
  if (input.conducta.length < 5) {
    throw new Error(`Expected at least 5 conduct policies, found ${input.conducta.length}.`);
  }

  const conductRules = [...input.conducta]
    .sort((a, b) => a.priority - b.priority)
    .map((policy) => policy.rule)
    .join(CONDUCT_SEPARATOR);

  const skillLines = input.skills.length
    ? input.skills.map((skill) => `- ${skill.id}: ${skill.description}`).join('\n')
    : '(no skills available)';

  const sections = [
    BASE_IDENTITY[input.lang],
    `${CONDUCT_HEADER[input.lang]}\n${conductRules}`,
    input.agent.systemPrompt.trim(),
    `## Skills\n${skillLines}`,
  ].filter(Boolean);

  const prompt = sections.join('\n\n');
  const estimatedTokens = tokenCount(prompt);
  if (estimatedTokens > MAX_SYSTEM_PROMPT_TOKENS) {
    throw new SystemPromptTooLargeError(estimatedTokens);
  }
  return prompt;
}
