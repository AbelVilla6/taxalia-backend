import { describe, expect, it } from 'vitest';
import { renderPostHtml } from '../../src/content/markdown.js';

describe('renderPostHtml', () => {
  it('renders heading ids, preserves sanitization, and returns a toc', () => {
    const { html, toc } = renderPostHtml(`
# Intro

## Why it matters

<script>alert('xss')</script>

### Details
`);

    expect(html).toContain('<h2 id="why-it-matters">Why it matters</h2>');
    expect(html).toContain('<h3 id="details">Details</h3>');
    expect(html).not.toContain('<script');
    expect(toc).toEqual([
      { id: 'why-it-matters', text: 'Why it matters', depth: 2 },
      { id: 'details', text: 'Details', depth: 3 },
    ]);
  });

  it('deduplicates repeated headings', () => {
    const { html, toc } = renderPostHtml('## Same\n\n## Same');

    expect(html).toContain('id="same"');
    expect(html).toContain('id="same-2"');
    expect(toc).toEqual([
      { id: 'same', text: 'Same', depth: 2 },
      { id: 'same-2', text: 'Same', depth: 2 },
    ]);
  });
});
