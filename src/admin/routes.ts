import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import type { PostRepository } from '../content/repository.js';
import { PostSchema } from '../content/schema.js';
import { renderPostHtml } from '../content/markdown.js';
import type { AuthService } from './auth.js';

export const SESSION_COOKIE = 'admin_session';

export interface AdminDeps {
  repo: PostRepository;
  auth: AuthService;
  uploadDir: string;
  sessionTtlMs: number;
  cookieSecure: boolean;
}

const LoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

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

  const app = new Hono();

  app.post('/login', async (c: Context) => {
    const parsed = LoginSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'INVALID_BODY' }, 400);
    }

    const token = auth.login(parsed.data.username, parsed.data.password);
    if (!token) {
      return c.json({ error: 'INVALID_CREDENTIALS' }, 401);
    }

    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: cookieSecure,
      path: '/',
      maxAge: Math.floor(sessionTtlMs / 1000),
    });
    return c.json({ ok: true, username: parsed.data.username });
  });

  app.post('/logout', (c: Context) => {
    auth.logout(getCookie(c, SESSION_COOKIE));
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  app.get('/me', requireAuth, (c: Context) => {
    return c.json({ username: c.get('username') });
  });

  // Live preview: renders Markdown with the exact same sanitizer used on
  // publish, so the editor preview matches the published article 1:1.
  app.post('/preview', requireAuth, async (c: Context) => {
    const body = (await c.req.json().catch(() => null)) as { markdown?: unknown } | null;
    const markdown = typeof body?.markdown === 'string' ? body.markdown : '';
    return c.json({ html: renderPostHtml(markdown).html });
  });

  app.get('/posts', requireAuth, (c: Context) => {
    return c.json({ posts: repo.listAll() });
  });

  app.get('/posts/:id', requireAuth, (c: Context) => {
    const id = Number(c.req.param('id'));
    const post = repo.getById(id);
    if (!post) return c.json({ error: 'POST_NOT_FOUND' }, 404);
    return c.json({ post });
  });

  app.post('/posts', requireAuth, async (c: Context) => {
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

  app.put('/posts/:id', requireAuth, async (c: Context) => {
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

  app.delete('/posts/:id', requireAuth, (c: Context) => {
    const id = Number(c.req.param('id'));
    const ok = repo.removeById(id);
    if (!ok) return c.json({ error: 'POST_NOT_FOUND' }, 404);
    return c.json({ ok: true });
  });

  app.post('/media', requireAuth, async (c: Context) => {
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

    // Public URL is served by the backend at /uploads/<name>.
    return c.json({ url: `/uploads/${name}` }, 201);
  });

  return app;
}
