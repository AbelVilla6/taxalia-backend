import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ADMIN_ASSETS = [
  'src/admin/public/index.html',
  'src/admin/public/app.js',
  'src/admin/public/preview.css',
];

describe('admin static assets', () => {
  it('do not reference external https dependencies', () => {
    for (const asset of ADMIN_ASSETS) {
      const source = readFileSync(new URL(`../../${asset}`, import.meta.url), 'utf8');
      expect(source).not.toContain('https://');
    }
  });
});
