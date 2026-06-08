export const TAXALIA_OPTIONS_BLOCK_RE = /```taxalia-options-json\s*[\s\S]*?```/gi;
export const TAXALIA_OPTIONS_INCOMPLETE_BLOCK_RE = /```taxalia-options-json\s*[\s\S]*$/i;

export function stripTaxaliaOptionsBlocks(text: string): string {
  return text
    .replace(TAXALIA_OPTIONS_BLOCK_RE, '')
    .replace(TAXALIA_OPTIONS_INCOMPLETE_BLOCK_RE, '')
    .trimEnd();
}
