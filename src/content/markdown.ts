import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import type { TocEntry } from './schema.js';

/**
 * Renders post Markdown to sanitized HTML.
 *
 * Posts are authored by trusted editors and may embed presentational HTML
 * (figures, galleries, callouts, local <video>, and YouTube/Vimeo <iframe>).
 * We keep that markup but run it through an allowlist so a compromised or
 * careless edit cannot inject scripts or arbitrary embeds.
 */
const IFRAME_HOSTS = [
  'www.youtube.com',
  'youtube.com',
  'www.youtube-nocookie.com',
  'player.vimeo.com',
];

function slugifyHeading(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'section'
  );
}

function stripTags(html: string): string {
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }).trim();
}

export function renderPostHtml(markdown: string): { html: string; toc: TocEntry[] } {
  const rawHtml = marked.parse(markdown, { async: false }) as string;
  const toc: TocEntry[] = [];
  const seen = new Map<string, number>();

  const withHeadingIds = rawHtml.replace(
    /<h([1-6])>([\s\S]*?)<\/h\1>/g,
    (_match, depth: string, innerHtml: string) => {
      const text = stripTags(innerHtml);
      const baseId = slugifyHeading(text);
      const count = seen.get(baseId) ?? 0;
      seen.set(baseId, count + 1);
      const id = count === 0 ? baseId : `${baseId}-${count + 1}`;
      const level = Number(depth);

      if (level >= 2 && level <= 4) {
        toc.push({ id, text, depth: level as 2 | 3 | 4 });
      }

      return `<h${level} id="${id}">${innerHtml}</h${level}>`;
    },
  );

  const html = sanitizeHtml(withHeadingIds, {
    allowedTags: [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'p', 'a', 'ul', 'ol', 'li', 'blockquote',
      'strong', 'em', 'code', 'pre', 'br', 'hr', 'span', 'div',
      'figure', 'figcaption', 'img', 'video', 'source', 'iframe',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
    ],
    allowedAttributes: {
      '*': ['class'],
      h1: ['id'],
      h2: ['id'],
      h3: ['id'],
      h4: ['id'],
      h5: ['id'],
      h6: ['id'],
      a: ['href', 'name', 'target', 'rel'],
      img: ['src', 'alt', 'loading', 'width', 'height'],
      video: ['controls', 'preload', 'poster', 'width', 'height'],
      source: ['src', 'type'],
      iframe: ['src', 'title', 'loading', 'allow', 'allowfullscreen', 'frameborder', 'width', 'height'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['http', 'https', 'data'] },
    allowedIframeHostnames: IFRAME_HOSTS,
    // Keep relative URLs (e.g. /assets/blog/...) intact.
    allowProtocolRelative: false,
  });

  return { html, toc };
}
