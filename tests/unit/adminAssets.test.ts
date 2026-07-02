import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const INDEX_HTML = 'src/admin/public/index.html';
const APP_JS = 'src/admin/public/app.js';

describe('admin static assets', () => {
  it('loads Toast UI from the official CDN', () => {
    const source = readFileSync(new URL(`../../${INDEX_HTML}`, import.meta.url), 'utf8');
    expect(source).toContain(
      'https://uicdn.toast.com/editor/latest/toastui-editor.min.css',
    );
    expect(source).toContain(
      'https://uicdn.toast.com/editor/latest/toastui-editor-all.min.js',
    );
  });

  it('keeps the YouTube embed URLs intentional and user-facing', () => {
    const source = readFileSync(new URL(`../../${APP_JS}`, import.meta.url), 'utf8');

    expect(source).toContain('https://youtu.be/xxxxx');
    expect(source).toContain('https://www.youtube.com/watch?v=xxxxx');
    expect(source).toContain('https://www.youtube-nocookie.com/embed/');
  });

  it('renders admin pubDate cells with textContent', () => {
    const source = readFileSync(new URL(`../../${APP_JS}`, import.meta.url), 'utf8');

    expect(source).toContain("dateCell.textContent = p.pubDate");
    expect(source).not.toContain('<td>${p.pubDate}</td>');
  });
});
