import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

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

export function renderPostHtml(markdown: string): string {
  const rawHtml = marked.parse(markdown, { async: false }) as string;

  return sanitizeHtml(rawHtml, {
    allowedTags: [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'p', 'a', 'ul', 'ol', 'li', 'blockquote',
      'strong', 'em', 'code', 'pre', 'br', 'hr', 'span', 'div',
      'figure', 'figcaption', 'img', 'video', 'source', 'iframe',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
    ],
    allowedAttributes: {
      '*': ['class'],
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
}
