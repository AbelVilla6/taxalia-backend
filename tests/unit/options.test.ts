import { describe, expect, it } from 'vitest';
import { stripTaxaliaOptionsBlocks } from '../../src/chat/options.js';

describe('stripTaxaliaOptionsBlocks', () => {
  it('removes complete Taxalia options fences', () => {
    const text = `Hola.

\`\`\`taxalia-options-json
{"options":[]}
\`\`\``;

    expect(stripTaxaliaOptionsBlocks(text)).toBe('Hola.');
  });

  it('removes malformed Taxalia options fences without closing backticks', () => {
    const text = `Hola, soy Lexi.

\`\`\`taxalia-options-json
{
  "options": [
    { "id": "estimate", "label": "Estimación", "message": "Quiero realizar una valoración" }
  ]
}`;

    expect(stripTaxaliaOptionsBlocks(text)).toBe('Hola, soy Lexi.');
  });
});
