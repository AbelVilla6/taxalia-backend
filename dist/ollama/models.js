export const DEFAULT_LOCAL_MODEL = 'gemma4:e4b';
export const DEFAULT_PRODUCTION_MODEL = 'gemma4:31b-cloud';
export const MODEL = DEFAULT_LOCAL_MODEL;
export const TOKEN_ESTIMATE_CHARS_PER_TOKEN = 4;
export const TOKEN_ESTIMATE_PROMPT_OVERHEAD = 10;
export function tokenEstimate(text) {
    return Math.ceil(text.length / TOKEN_ESTIMATE_CHARS_PER_TOKEN + TOKEN_ESTIMATE_PROMPT_OVERHEAD);
}
