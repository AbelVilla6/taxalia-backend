import type { AgentDef } from '../agents/loader.js';
import type { ConductDef } from '../conducta/loader.js';
import type { Lang } from '../chat/schemas.js';
import type { SkillDef } from '../skills/loader.js';
import { tokenEstimate } from '../ollama/models.js';

const MAX_SYSTEM_PROMPT_TOKENS = 1500;
const CONDUCT_SEPARATOR = '\n\n---\n\n';

const BASE_IDENTITY: Record<Lang, string> = {
  en: 'You are Lexi, the AI assistant for LB&Co Global Advisors. Answer clearly, stay within LB&Co Global Advisors services, and hand off to a human when the user needs personalized advice.',
  es: 'Eres Lexi, la asistente de IA de LB&Co Global Advisors. Responde en castellano de España cuando hables en español. Responde con claridad, mantente dentro de los servicios de LB&Co Global Advisors y deriva a una persona cuando el usuario necesite asesoramiento personalizado.',
};

const RESPONSE_FORMAT: Record<Lang, string> = {
  en: [
    '## Response format',
    'Answer the user in Markdown. Keep the visible answer as plain Markdown text.',
    'Keep answers to 20 words or fewer. If the user truly needs a longer answer, use at most 50 words.',
    'Only when the user needs a choice, append exactly one fenced block at the very end of the response using the label `taxalia-options-json`.',
    'Use this deterministic JSON shape:',
    '```taxalia-options-json',
    '{',
    '  "options": [',
    '    { "id": "advisory", "label": "Advisory", "message": "I need advisory help" }',
    '  ]',
    '}',
    '```',
    'Keep `id`, `label`, and `message` short and safe. Do not include HTML in JSON values. Do not include the options block when no choice is needed.',
  ].join('\n'),
  es: [
    '## Formato de respuesta',
    'Responde al usuario en Markdown y en castellano de España. Mantén la respuesta visible como texto Markdown simple.',
    'Mantén las respuestas en 20 palabras o menos. Si el usuario realmente necesita una respuesta más larga, usa como máximo 50 palabras.',
    'Solo cuando el usuario necesite elegir entre opciones, agregá exactamente un bloque con fence al final de la respuesta usando la etiqueta `taxalia-options-json`.',
    'Usa esta forma determinista de JSON:',
    '```taxalia-options-json',
    '{',
    '  "options": [',
    '    { "id": "advisory", "label": "Asesoría", "message": "Necesito asesoría" }',
    '  ]',
    '}',
    '```',
    'Mantén `id`, `label` y `message` cortos y seguros. No incluyas HTML en los valores JSON. No incluyas el bloque de opciones cuando no haga falta elegir.',
  ].join('\n'),
};

const CONDUCT_HEADER: Record<Lang, string> = {
  en: '## Conduct policies',
  es: '## Políticas de conducta',
};

const BOOKING_SECTION: Record<Lang, (url: string) => string> = {
  en: (url) =>
    `## Booking\nIf you cannot confidently answer, or the user needs personalized review, offer to book a free consultation: ${url}. Also offer it when the user asks for an appointment.`,
  es: (url) =>
    `## Reserva\nSi no puedes responder con seguridad, o el usuario necesita una revisión personalizada, ofrece agendar una consulta gratuita: ${url}. Ofrécela también cuando el usuario pida una cita.`,
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
  bookingUrl?: string;
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

  const bookingSection = input.bookingUrl
    ? BOOKING_SECTION[input.lang](input.bookingUrl)
    : null;

  const sections = [
    BASE_IDENTITY[input.lang],
    `${CONDUCT_HEADER[input.lang]}\n${conductRules}`,
    input.agent.systemPrompt.trim(),
    `## Skills\n${skillLines}`,
    bookingSection,
    RESPONSE_FORMAT[input.lang],
  ].filter(Boolean);

  const prompt = sections.join('\n\n');
  const estimatedTokens = tokenCount(prompt);
  if (estimatedTokens > MAX_SYSTEM_PROMPT_TOKENS) {
    throw new SystemPromptTooLargeError(estimatedTokens);
  }
  return prompt;
}
