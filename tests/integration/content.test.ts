import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { openBlogDb } from '../../src/content/db.js';
import { PostRepository } from '../../src/content/repository.js';
import { buildContentRouter } from '../../src/content/routes.js';
import { seedIfEmpty } from '../../src/content/seed.js';

function makeApp(): Hono {
  const repo = new PostRepository(openBlogDb(':memory:'));
  seedIfEmpty(repo);
  const app = new Hono();
  app.route('/api', buildContentRouter(repo));
  return app;
}

describe('content API', () => {
  let app: Hono;

  beforeEach(() => {
    app = makeApp();
  });

  it('lists published posts per language, newest first', async () => {
    const res = await app.fetch(new Request('http://x/api/posts?lang=en'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { lang: string; posts: { slug: string; pubDate: string }[] };

    expect(body.lang).toBe('en');
    expect(body.posts.length).toBeGreaterThanOrEqual(2);
    expect(body.posts.every((p) => 'slug' in p)).toBe(true);
    // sorted by pubDate desc
    const dates = body.posts.map((p) => p.pubDate);
    expect([...dates].sort((a, b) => b.localeCompare(a))).toEqual(dates);
  });

  it('isolates languages', async () => {
    const en = (await (await app.fetch(new Request('http://x/api/posts?lang=en'))).json()) as {
      posts: { lang: string }[];
    };
    const es = (await (await app.fetch(new Request('http://x/api/posts?lang=es'))).json()) as {
      posts: { lang: string }[];
    };
    expect(en.posts.every((p) => p.lang === 'en')).toBe(true);
    expect(es.posts.every((p) => p.lang === 'es')).toBe(true);
  });

  it('returns a single post with rendered, sanitized HTML', async () => {
    const res = await app.fetch(
      new Request('http://x/api/posts/ejemplo-post-multimedia?lang=es'),
    );
    expect(res.status).toBe(200);
    const { post } = (await res.json()) as { post: { contentHtml: string; title: string } };

    expect(post.title).toBe('Ejemplo de post multimedia');
    expect(post.contentHtml).toContain('<figure');
    expect(post.contentHtml).toContain('youtube.com/embed');
    expect(post.contentHtml).not.toContain('<script');
  });

  it('404s on cross-language slug and unknown slug', async () => {
    // es-only slug requested under en
    const cross = await app.fetch(
      new Request('http://x/api/posts/ejemplo-post-multimedia?lang=en'),
    );
    expect(cross.status).toBe(404);

    const missing = await app.fetch(new Request('http://x/api/posts/nope?lang=en'));
    expect(missing.status).toBe(404);
  });

  it('400s on invalid language', async () => {
    const res = await app.fetch(new Request('http://x/api/posts?lang=fr'));
    expect(res.status).toBe(400);
  });
});
