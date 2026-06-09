import { Hono, type Context } from 'hono';
import type { PostRepository } from './repository.js';
import { LangSchema } from './schema.js';

function resolveLang(c: Context): ReturnType<typeof LangSchema.safeParse> {
  return LangSchema.safeParse(c.req.query('lang') ?? 'en');
}

/**
 * Public, read-only blog content API. Mounted under `/api`.
 *
 *   GET /api/posts?lang=en|es        -> list of published post summaries
 *   GET /api/posts/:slug?lang=en|es  -> single published post with rendered HTML
 *
 * Write/admin endpoints are intentionally out of scope here (Phase 2).
 */
export function buildContentRouter(repo: PostRepository): Hono {
  const app = new Hono();

  app.get('/posts', (c: Context) => {
    const lang = resolveLang(c);
    if (!lang.success) {
      return c.json({ error: 'INVALID_LANG', allowed: ['en', 'es'] }, 400);
    }

    return c.json({ lang: lang.data, posts: repo.list(lang.data) });
  });

  app.get('/posts/:slug', (c: Context) => {
    const lang = resolveLang(c);
    if (!lang.success) {
      return c.json({ error: 'INVALID_LANG', allowed: ['en', 'es'] }, 400);
    }

    const slug = c.req.param('slug') ?? '';
    const post = repo.get(slug, lang.data);
    if (!post) {
      return c.json({ error: 'POST_NOT_FOUND', slug, lang: lang.data }, 404);
    }

    return c.json({ post });
  });

  return app;
}
