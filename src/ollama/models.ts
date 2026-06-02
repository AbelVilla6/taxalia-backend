export const MODEL = 'gemma4:e4b' as const;
export const TOKEN_ESTIMATE_CHARS_PER_TOKEN = 4;
export const TOKEN_ESTIMATE_PROMPT_OVERHEAD = 10;

export function tokenEstimate(text: string): number {
  return Math.ceil(text.length / TOKEN_ESTIMATE_CHARS_PER_TOKEN + TOKEN_ESTIMATE_PROMPT_OVERHEAD);
}
