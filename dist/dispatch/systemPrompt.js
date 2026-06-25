import { tokenEstimate } from '../ollama/models.js';
const MAX_SYSTEM_PROMPT_TOKENS = 1500;
const CONDUCT_SEPARATOR = '\n\n---\n\n';
const BASE_IDENTITY = {
    en: 'You are Lexi, the AI assistant for Taxalia. Answer clearly, stay within Taxalia services, and hand off to a human when the user needs personalized advice.',
    es: 'Eres Lexi, la asistente de IA de Taxalia. Responde en castellano de España cuando hables en español. Responde con claridad, mantente dentro de los servicios de Taxalia y deriva a una persona cuando el usuario necesite asesoramiento personalizado.',
};
const RESPONSE_FORMAT = {
    en: [
        '## Response format',
        'Answer the user in Markdown. Keep the visible answer as plain Markdown text.',
        'Keep answers to 20 words or fewer. If the user truly needs a longer answer, use at most 50 words.',
        'Only when the user needs a choice, append exactly one fenced block at the very end of the response using the label `taxalia-options-json`.',
        'Use this deterministic JSON shape:',
        '```taxalia-options-json',
        '{',
        '  "options": [',
        '    { "id": "income-tax", "label": "Income Tax", "message": "Tell me about income tax" }',
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
        '    { "id": "income-tax", "label": "Renta", "message": "Cuéntame sobre renta" }',
        '  ]',
        '}',
        '```',
        'Mantén `id`, `label` y `message` cortos y seguros. No incluyas HTML en los valores JSON. No incluyas el bloque de opciones cuando no haga falta elegir.',
    ].join('\n'),
};
const CONDUCT_HEADER = {
    en: '## Conduct policies',
    es: '## Políticas de conducta',
};
const BOOKING_SECTION = {
    en: (url) => [
        '## Booking',
        'If you cannot confidently answer, or the user needs personalized review, or the user asks for an appointment, respond with a short sentence and then append exactly one `taxalia-booking-json` fenced block at the very end of your response.',
        'Use this exact shape:',
        '```taxalia-booking-json',
        `{"url":"${url}","label":"Book a free consultation"}`,
        '```',
        'Do NOT include the raw URL as plain text. Do NOT include the block more than once.',
    ].join('\n'),
    es: (url) => [
        '## Reserva',
        'Si no puedes responder con seguridad, o el usuario necesita una revisión personalizada, o el usuario pide una cita, responde con una frase corta y luego añade exactamente un bloque `taxalia-booking-json` al final de tu respuesta.',
        'Usa exactamente esta forma:',
        '```taxalia-booking-json',
        `{"url":"${url}","label":"Agendar consulta gratuita"}`,
        '```',
        'NO incluyas la URL como texto plano. NO incluyas el bloque más de una vez.',
    ].join('\n'),
};
export class SystemPromptTooLargeError extends Error {
    tokenCount;
    constructor(tokenCount) {
        super(`System prompt is too large: ${tokenCount} tokens estimated, max ${MAX_SYSTEM_PROMPT_TOKENS}.`);
        this.tokenCount = tokenCount;
        this.name = 'SystemPromptTooLargeError';
    }
}
export function tokenCount(prompt) {
    return tokenEstimate(prompt);
}
export function assembleSystemPrompt(input) {
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
    const agentSections = [input.agent.systemPrompt.trim(), input.agent.body?.trim()].filter(Boolean).join('\n\n');
    const sections = [
        BASE_IDENTITY[input.lang],
        `${CONDUCT_HEADER[input.lang]}\n${conductRules}`,
        agentSections,
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
