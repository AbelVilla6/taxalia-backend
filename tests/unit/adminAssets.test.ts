import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ADMIN_ASSETS = [
  'src/admin/public/index.html',
  'src/admin/public/app.js',
  'src/admin/public/preview.css',
];

describe('admin static assets', () => {
  it('do not reference external dependencies', () => {
    for (const asset of ADMIN_ASSETS) {
      const source = readFileSync(new URL(`../../${asset}`, import.meta.url), 'utf8');
      expect(source).not.toMatch(/['"`](?:https?:)?\/\/[^'"`\s]+/);
    }
  });

  it('renders admin pubDate cells with textContent', () => {
    const source = readFileSync(new URL('../../src/admin/public/app.js', import.meta.url), 'utf8');

    expect(source).toContain("dateCell.textContent = p.pubDate");
    expect(source).not.toContain('<td>${p.pubDate}</td>');
  });
});
