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
    const body = (await res.json()) as {
      lang: string;
      posts: { slug: string; pubDate: string; translationGroupId: string; published: boolean }[];
    };

    expect(body.lang).toBe('en');
    expect(body.posts.length).toBeGreaterThanOrEqual(2);
    expect(body.posts.every((p) => p.translationGroupId)).toBe(true);
    expect(body.posts.every((p) => p.published)).toBe(true);
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

  it('returns a single post with SEO payload, alternates, and toc', async () => {
    const res = await app.fetch(new Request('http://x/api/posts/fbar-foreign-bank-accounts?lang=en'));
    expect(res.status).toBe(200);
    const { post } = (await res.json()) as {
      post: {
        title: string;
        contentHtml: string;
        translationGroupId: string;
        published: boolean;
        alternates: Record<string, { slug: string; url: string }>;
        seo: {
          metaTitle: string;
          metaDescription: string;
          canonicalUrl: string;
          focusKeyword: string | null;
          secondaryKeywords: string[];
          openGraphImage: string | null;
        };
        toc: { id: string; text: string; depth: 2 | 3 | 4 }[];
        articleJsonLd: Record<string, unknown>;
      };
    };

    expect(post.title).toBe('FBAR: reporting foreign bank and financial accounts');
    expect(post.translationGroupId).toBe('fbar-foreign-bank-accounts');
    expect(post.published).toBe(true);
    expect(post.contentHtml).toContain('<h2 id="what-is-the-fbar">What is the FBAR?</h2>');
    expect(post.contentHtml).not.toContain('<script');
    expect(post.alternates.en.slug).toBe('fbar-foreign-bank-accounts');
    expect(post.alternates.es.slug).toBe('fbar-cuentas-bancarias-extranjeras');
    expect(post.seo.metaTitle).toBe('FBAR: reporting foreign bank and financial accounts');
    expect(post.seo.metaDescription).toBe(
      'A practical guide to when U.S. taxpayers may need to file FinCEN Form 114 for foreign financial accounts.',
    );
    expect(post.seo.canonicalUrl).toBe('http://localhost:4321/blog/fbar-foreign-bank-accounts');
    expect(post.toc[0]).toEqual({ id: 'what-is-the-fbar', text: 'What is the FBAR?', depth: 2 });
    expect(post.toc.length).toBeGreaterThan(1);
    expect(post.articleJsonLd['@type']).toBe('Article');
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

  it('hides unpublished translation groups from public output', async () => {
    const repo = new PostRepository(openBlogDb(':memory:'));
    seedIfEmpty(repo);
    repo.upsert({
      slug: 'hidden-en',
      lang: 'en',
      translationGroupId: 'hidden-group',
      title: 'Hidden EN',
      description: '',
      bodyMd: '## Hidden',
      author: 'Taxalia',
      heroImage: null,
      heroAlt: null,
      tags: [],
      draft: false,
      pubDate: '2026-06-10',
      updatedDate: null,
      metaTitle: null,
      metaDescription: null,
      focusKeyword: null,
      secondaryKeywords: [],
      openGraphImage: null,
      openGraphTitle: null,
      openGraphDescription: null,
    });
    repo.upsert({
      slug: 'hidden-es',
      lang: 'es',
      translationGroupId: 'hidden-group',
      title: 'Hidden ES',
      description: '',
      bodyMd: '## Oculto',
      author: 'Taxalia',
      heroImage: null,
      heroAlt: null,
      tags: [],
      draft: false,
      pubDate: '2026-06-10',
      updatedDate: null,
      metaTitle: null,
      metaDescription: null,
      focusKeyword: null,
      secondaryKeywords: [],
      openGraphImage: null,
      openGraphTitle: null,
      openGraphDescription: null,
    });

    repo.upsert({
      slug: 'hidden-en',
      lang: 'en',
      translationGroupId: 'hidden-group',
      title: 'Hidden EN',
      description: '',
      bodyMd: '## Hidden',
      author: 'Taxalia',
      heroImage: null,
      heroAlt: null,
      tags: [],
      draft: true,
      pubDate: '2026-06-10',
      updatedDate: null,
      metaTitle: null,
      metaDescription: null,
      focusKeyword: null,
      secondaryKeywords: [],
      openGraphImage: null,
      openGraphTitle: null,
      openGraphDescription: null,
    });

    const app = new Hono();
    app.route('/api', buildContentRouter(repo));

    const list = await app.fetch(new Request('http://x/api/posts?lang=en'));
    const body = (await list.json()) as { posts: { slug: string }[] };
    expect(body.posts.some((post) => post.slug === 'hidden-en')).toBe(false);

    const detail = await app.fetch(new Request('http://x/api/posts/hidden-en?lang=en'));
    expect(detail.status).toBe(404);
  });

  it('exposes stored custom JSON-LD alongside the generated Article JSON-LD', async () => {
    const repo = new PostRepository(openBlogDb(':memory:'));
    const faqJsonLd = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      inLanguage: 'es',
      mainEntity: [],
    });
    repo.upsert({
      slug: 'faq-es',
      lang: 'es',
      translationGroupId: 'faq-group',
      title: 'FAQ ES',
      description: 'desc',
      bodyMd: '## Una sección',
      author: 'Taxalia',
      heroImage: null,
      heroAlt: null,
      tags: [],
      draft: false,
      pubDate: '2026-06-10',
      updatedDate: null,
      metaTitle: null,
      metaDescription: null,
      focusKeyword: null,
      secondaryKeywords: [],
      openGraphImage: null,
      openGraphTitle: null,
      openGraphDescription: null,
      jsonLd: faqJsonLd,
    });

    const app = new Hono();
    app.route('/api', buildContentRouter(repo));

    const res = await app.fetch(new Request('http://x/api/posts/faq-es?lang=es'));
    expect(res.status).toBe(200);
    const { post } = (await res.json()) as {
      post: {
        articleJsonLd: Record<string, unknown>;
        customJsonLd: Record<string, unknown> | null;
      };
    };
    expect(post.articleJsonLd['@type']).toBe('Article');
    expect(post.customJsonLd?.['@type']).toBe('FAQPage');
  });

  it('returns null custom JSON-LD when none is stored', async () => {
    const res = await app.fetch(new Request('http://x/api/posts/fbar-foreign-bank-accounts?lang=en'));
    const { post } = (await res.json()) as { post: { customJsonLd: unknown } };
    expect(post.customJsonLd).toBeNull();
  });
});
