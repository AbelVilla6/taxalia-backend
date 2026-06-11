import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import type { PostRepository } from '../content/repository.js';
import { LangSchema, PostSchema } from '../content/schema.js';
import { renderPostHtml } from '../content/markdown.js';
import type { OllamaClient } from '../ollama/interface.js';
import type { AuthService } from './auth.js';

export const SESSION_COOKIE = 'admin_session';

const TRANSLATE_SKILL_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../editorial/translate-post.md',
);

export interface AdminDeps {
  repo: PostRepository;
  auth: AuthService;
  uploadDir: string;
  sessionTtlMs: number;
  cookieSecure: boolean;
  /** Absolute public base URL of the backend (e.g. https://api.taxalia.com). When set, uploaded media URLs are absolute instead of relative. */
  backendPublicUrl?: string;
  /** Optional: enables the editorial translate endpoint. */
  ollama?: OllamaClient;
}

const LoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

const TranslateRequestSchema = z.object({
  post: z.object({
    title: z.string().min(1),
    slug: z.string().default(''),
    lang: LangSchema,
    description: z.string().default(''),
    bodyMd: z.string().default(''),
    tags: z.array(z.string()).default([]),
    metaTitle: z.string().nullable().optional(),
    metaDescription: z.string().nullable().optional(),
    focusKeyword: z.string().nullable().optional(),
    secondaryKeywords: z.array(z.string()).optional(),
    openGraphTitle: z.string().nullable().optional(),
    openGraphDescription: z.string().nullable().optional(),
    jsonLd: z.string().nullable().optional(),
  }),
  targetLang: LangSchema,
});

/** What the model is allowed to fill in; everything is optional but title. */
const TranslatedPostSchema = z.object({
  title: z.string().min(1),
  slug: z.string().optional(),
  description: z.string().optional(),
  bodyMd: z.string().optional(),
  tags: z.array(z.string()).optional(),
  metaTitle: z.string().optional(),
  metaDescription: z.string().optional(),
  focusKeyword: z.string().optional(),
  secondaryKeywords: z.array(z.string()).optional(),
  openGraphTitle: z.string().optional(),
  openGraphDescription: z.string().optional(),
  jsonLd: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
});

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

const ALLOWED_UPLOAD_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
};

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

/**
 * Admin API: session auth + post CRUD + media upload. Mounted under
 * `/api/admin`. Everything except `/login` requires a valid session cookie.
 */
export function buildAdminRouter(deps: AdminDeps): Hono {
  const { repo, auth, uploadDir, sessionTtlMs, cookieSecure } = deps;

  const requireAuth: MiddlewareHandler = async (c, next) => {
    const username = auth.validate(getCookie(c, SESSION_COOKIE));
    if (!username) {
      return c.json({ error: 'UNAUTHORIZED' }, 401);
    }
    c.set('username', username);
    await next();
  };

  // Seeded credentials are placeholders: until they are replaced, the session
  // can only be used to change the password (and check /me / log out).
  const requireFreshPassword: MiddlewareHandler = async (c, next) => {
    if (auth.mustChangePassword(c.get('username'))) {
      return c.json({ error: 'PASSWORD_CHANGE_REQUIRED' }, 403);
    }
    await next();
  };

  const app = new Hono();

  app.post('/login', async (c: Context) => {
    const parsed = LoginSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'INVALID_BODY' }, 400);
    }

    const result = auth.login(parsed.data.username, parsed.data.password);
    if (!result) {
      return c.json({ error: 'INVALID_CREDENTIALS' }, 401);
    }

    setCookie(c, SESSION_COOKIE, result.token, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: cookieSecure,
      path: '/',
      maxAge: Math.floor(sessionTtlMs / 1000),
    });
    return c.json({
      ok: true,
      username: parsed.data.username,
      mustChangePassword: result.mustChangePassword,
    });
  });

  app.post('/logout', (c: Context) => {
    auth.logout(getCookie(c, SESSION_COOKIE));
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  app.get('/me', requireAuth, (c: Context) => {
    return c.json({
      username: c.get('username'),
      mustChangePassword: auth.mustChangePassword(c.get('username')),
    });
  });

  app.post('/password', requireAuth, async (c: Context) => {
    const parsed = ChangePasswordSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'INVALID_BODY', issues: parsed.error.issues }, 400);
    }
    const ok = auth.changePassword(
      c.get('username'),
      parsed.data.currentPassword,
      parsed.data.newPassword,
    );
    if (!ok) {
      return c.json({ error: 'INVALID_CREDENTIALS' }, 401);
    }
    return c.json({ ok: true });
  });

  // Editorial AI: translates a post to the other language (and proposes SEO
  // fields / JSON-LD) by sending the translate-post skill plus the source
  // content to the Ollama model.
  app.post('/translate', requireAuth, requireFreshPassword, async (c: Context) => {
    if (!deps.ollama) {
      return c.json({ error: 'TRANSLATION_UNAVAILABLE' }, 503);
    }
    const parsed = TranslateRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'INVALID_BODY', issues: parsed.error.issues }, 400);
    }
    const { post, targetLang } = parsed.data;
    if (post.lang === targetLang) {
      return c.json({ error: 'SAME_LANGUAGE' }, 400);
    }

    const skill = readFileSync(TRANSLATE_SKILL_PATH, 'utf8');
    let raw: string;
    try {
      const response = await deps.ollama.chatOnce({
        system: skill,
        messages: [
          {
            role: 'user',
            content: JSON.stringify({ targetLang, post }),
          },
        ],
        format: 'json',
      });
      raw = response.content;
    } catch (err) {
      return c.json(
        { error: 'OLLAMA_ERROR', detail: err instanceof Error ? err.message : String(err) },
        502,
      );
    }

    let candidate: unknown;
    try {
      candidate = JSON.parse(raw);
    } catch {
      return c.json({ error: 'MODEL_OUTPUT_INVALID' }, 502);
    }
    const translated = TranslatedPostSchema.safeParse(candidate);
    if (!translated.success) {
      return c.json({ error: 'MODEL_OUTPUT_INVALID', issues: translated.error.issues }, 502);
    }

    const t = translated.data;
    const jsonLd =
      t.jsonLd == null ? null : typeof t.jsonLd === 'string' ? t.jsonLd : JSON.stringify(t.jsonLd);

    return c.json({
      post: {
        lang: targetLang,
        title: t.title,
        slug: t.slug?.trim() || slugify(t.title),
        description: t.description ?? '',
        bodyMd: t.bodyMd ?? '',
        tags: t.tags ?? post.tags,
        metaTitle: t.metaTitle ?? null,
        metaDescription: t.metaDescription ?? null,
        focusKeyword: t.focusKeyword ?? null,
        secondaryKeywords: t.secondaryKeywords ?? [],
        openGraphTitle: t.openGraphTitle ?? null,
        openGraphDescription: t.openGraphDescription ?? null,
        jsonLd,
      },
    });
  });

  // Live preview: renders Markdown with the exact same sanitizer used on
  // publish, so the editor preview matches the published article 1:1.
  app.post('/preview', requireAuth, requireFreshPassword, async (c: Context) => {
    const body = (await c.req.json().catch(() => null)) as { markdown?: unknown } | null;
    const markdown = typeof body?.markdown === 'string' ? body.markdown : '';
    return c.json({ html: renderPostHtml(markdown).html });
  });

  app.get('/posts', requireAuth, requireFreshPassword, (c: Context) => {
    return c.json({ posts: repo.listAll() });
  });

  app.get('/posts/:id', requireAuth, requireFreshPassword, (c: Context) => {
    const id = Number(c.req.param('id'));
    const post = repo.getById(id);
    if (!post) return c.json({ error: 'POST_NOT_FOUND' }, 404);
    return c.json({ post });
  });

  app.post('/posts', requireAuth, requireFreshPassword, async (c: Context) => {
    const parsed = PostSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'INVALID_BODY', issues: parsed.error.issues }, 400);
    }
    try {
      const id = repo.create(parsed.data);
      return c.json({ id }, 201);
    } catch (err) {
      // UNIQUE(slug, lang) violation
      if (String(err).includes('UNIQUE')) {
        return c.json({ error: 'SLUG_LANG_EXISTS' }, 409);
      }
      throw err;
    }
  });

  app.put('/posts/:id', requireAuth, requireFreshPassword, async (c: Context) => {
    const id = Number(c.req.param('id'));
    const parsed = PostSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'INVALID_BODY', issues: parsed.error.issues }, 400);
    }
    try {
      const ok = repo.updateById(id, parsed.data);
      if (!ok) return c.json({ error: 'POST_NOT_FOUND' }, 404);
      return c.json({ ok: true });
    } catch (err) {
      if (String(err).includes('UNIQUE')) {
        return c.json({ error: 'SLUG_LANG_EXISTS' }, 409);
      }
      throw err;
    }
  });

  app.delete('/posts/:id', requireAuth, requireFreshPassword, (c: Context) => {
    const id = Number(c.req.param('id'));
    const ok = repo.removeById(id);
    if (!ok) return c.json({ error: 'POST_NOT_FOUND' }, 404);
    return c.json({ ok: true });
  });

  app.post('/media', requireAuth, requireFreshPassword, async (c: Context) => {
    const body = await c.req.parseBody();
    const file = body['file'];
    if (!(file instanceof File)) {
      return c.json({ error: 'NO_FILE' }, 400);
    }

    const ext = ALLOWED_UPLOAD_MIME[file.type];
    if (!ext) {
      return c.json({ error: 'UNSUPPORTED_TYPE', type: file.type }, 415);
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return c.json({ error: 'FILE_TOO_LARGE', maxBytes: MAX_UPLOAD_BYTES }, 413);
    }

    mkdirSync(resolve(uploadDir), { recursive: true });
    const name = `${Date.now()}-${randomBytes(6).toString('hex')}${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(join(resolve(uploadDir), name), buffer);

    const base = deps.backendPublicUrl ? deps.backendPublicUrl.replace(/\/+$/, '') : '';
    return c.json({ url: `${base}/uploads/${name}` }, 201);
  });

  return app;
}
