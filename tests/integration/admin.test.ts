import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Hono } from 'hono';
import { closeBlogDb, openBlogDb } from '../../src/content/db.js';
import { PostRepository } from '../../src/content/repository.js';
import { AuthService } from '../../src/admin/auth.js';
import { buildAdminRouter, SESSION_COOKIE } from '../../src/admin/routes.js';
import { describeMySql, mysqlConfig, resetBlogTables } from './mysql.js';

async function setup({ firstLoginDone = true } = {}) {
  const db = await openBlogDb(mysqlConfig());
  try {
    await resetBlogTables(db);
    const repo = new PostRepository(db);
    const auth = new AuthService(db, 3_600_000);
    await auth.ensureAdminUser('admin', 'secret123');
    if (firstLoginDone) {
      // Seeded admins must change their password; complete that step so the
      // rest of the suite exercises a fully provisioned account.
      await auth.changePassword('admin', 'secret123', 'secret123');
    }
    const uploadDir = mkdtempSync(join(tmpdir(), 'taxalia-admin-'));
    const app = new Hono();
    app.route(
      '/api/admin',
      buildAdminRouter({ repo, auth, uploadDir, sessionTtlMs: 3_600_000, cookieSecure: false }),
    );
    return { app, db, repo, uploadDir };
  } catch (error) {
    await closeBlogDb(db);
    throw error;
  }
}

async function login(app: Hono, password = 'secret123'): Promise<string | null> {
  const res = await app.fetch(
    new Request('http://x/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password }),
    }),
  );
  if (!res.ok) return null;
  const setCookie = res.headers.get('set-cookie') ?? '';
  const match = setCookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  return match ? match[1] : null;
}

function authed(token: string, path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set('Cookie', `${SESSION_COOKIE}=${token}`);
  if (!headers.has('Content-Type') && init.body && typeof init.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }
  return new Request('http://x' + path, { ...init, headers });
}

async function upload(app: Hono, token: string, file: File): Promise<Response> {
  const body = new FormData();
  body.append('file', file);
  return app.fetch(
    new Request('http://x/api/admin/media', {
      method: 'POST',
      headers: { Cookie: `${SESSION_COOKIE}=${token}` },
      body,
    }),
  );
}

describeMySql('admin API', () => {
  let db: Awaited<ReturnType<typeof openBlogDb>> | undefined;
  let app: Hono;
  let uploadDir = '';

  beforeEach(async () => {
    ({ db, app, uploadDir } = await setup());
  });

  afterEach(async () => {
    if (db) {
      try {
        await resetBlogTables(db);
      } finally {
        await closeBlogDb(db);
        db = undefined;
      }
    }
    if (uploadDir) rmSync(uploadDir, { recursive: true, force: true });
    uploadDir = '';
  });

  it('rejects unauthenticated access', async () => {
    const res = await app.fetch(new Request('http://x/api/admin/posts'));
    expect(res.status).toBe(401);
  });

  it('rejects bad credentials, accepts good ones', async () => {
    expect(await login(app, 'wrong')).toBeNull();
    const token = await login(app);
    expect(token).toBeTruthy();
  });

  it('creates, lists, updates and deletes a post', async () => {
    const token = (await login(app))!;
    const body = JSON.stringify({
      title: 'Nuevo', slug: 'nuevo', lang: 'es', translationGroupId: 'nuevo',
      description: 'd', bodyMd: '# Hola', pubDate: '2026-01-01', draft: false,
    });

    const created = await app.fetch(authed(token, '/api/admin/posts', { method: 'POST', body }));
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: number };

    const list = await (await app.fetch(authed(token, '/api/admin/posts'))).json() as { posts: unknown[] };
    expect(list.posts.length).toBe(1);

    const upd = await app.fetch(
      authed(token, `/api/admin/posts/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          title: 'Editado', slug: 'nuevo', lang: 'es', translationGroupId: 'nuevo',
          description: 'd', bodyMd: '# Hola', pubDate: '2026-01-01', draft: false,
        }),
      }),
    );
    expect(upd.status).toBe(200);

    const del = await app.fetch(authed(token, `/api/admin/posts/${id}`, { method: 'DELETE' }));
    expect(del.status).toBe(200);

    const after = await app.fetch(authed(token, `/api/admin/posts/${id}`));
    expect(after.status).toBe(404);
  });

  it('409s on duplicate slug+lang', async () => {
    const token = (await login(app))!;
    const body = JSON.stringify({
      title: 'A', slug: 'dup', lang: 'es', translationGroupId: 'dup',
      description: '', bodyMd: '', pubDate: '2026-01-01', draft: false,
    });
    expect((await app.fetch(authed(token, '/api/admin/posts', { method: 'POST', body }))).status).toBe(201);
    expect((await app.fetch(authed(token, '/api/admin/posts', { method: 'POST', body }))).status).toBe(409);
  });

  it('rejects posts without a translation group id', async () => {
    const token = (await login(app))!;
    const res = await app.fetch(
      authed(token, '/api/admin/posts', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Missing group',
          slug: 'missing-group',
          lang: 'es',
          description: '',
          bodyMd: '',
          pubDate: '2026-01-01',
          draft: false,
        }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('rejects svg uploads and accepts allowed media', async () => {
    const token = (await login(app))!;

    const svg = await upload(app, token, new File(['<svg xmlns="http://www.w3.org/2000/svg"></svg>'], 'evil.svg', { type: 'image/svg+xml' }));
    expect(svg.status).toBe(415);

    const png = await upload(app, token, new File([new Uint8Array([137, 80, 78, 71])], 'image.png', { type: 'image/png' }));
    expect(png.status).toBe(201);

    const { url } = (await png.json()) as { url: string };
    expect(url).toMatch(/^\/uploads\//);
  });
});

describeMySql('custom JSON-LD', () => {
  let db: Awaited<ReturnType<typeof openBlogDb>> | undefined;
  let app: Hono;
  let uploadDir = '';

  beforeEach(async () => {
    ({ db, app, uploadDir } = await setup());
  });

  afterEach(async () => {
    if (db) {
      try {
        await resetBlogTables(db);
      } finally {
        await closeBlogDb(db);
        db = undefined;
      }
    }
    if (uploadDir) rmSync(uploadDir, { recursive: true, force: true });
    uploadDir = '';
  });

  const base = {
    title: 'Con JSON-LD', slug: 'con-jsonld', lang: 'es', translationGroupId: 'con-jsonld',
    description: 'd', bodyMd: '# Hola', pubDate: '2026-06-10', draft: true,
  };

  it('stores and returns a post custom JSON-LD', async () => {
    const token = (await login(app))!;
    const jsonLd = JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage' });

    const created = await app.fetch(
      authed(token, '/api/admin/posts', {
        method: 'POST',
        body: JSON.stringify({ ...base, jsonLd }),
      }),
    );
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: number };

    const fetched = await app.fetch(authed(token, '/api/admin/posts/' + id));
    const { post } = (await fetched.json()) as { post: { jsonLd: string | null } };
    expect(JSON.parse(post.jsonLd!)['@type']).toBe('FAQPage');
  });

  it('rejects JSON-LD that is not a JSON object', async () => {
    const token = (await login(app))!;
    const res = await app.fetch(
      authed(token, '/api/admin/posts', {
        method: 'POST',
        body: JSON.stringify({ ...base, jsonLd: 'not json at all' }),
      }),
    );
    expect(res.status).toBe(400);
  });
});

describeMySql('editorial translation', () => {
  let db: Awaited<ReturnType<typeof openBlogDb>> | undefined;
  let uploadDir = '';

  afterEach(async () => {
    if (db) {
      try {
        await resetBlogTables(db);
      } finally {
        await closeBlogDb(db);
        db = undefined;
      }
    }
    if (uploadDir) rmSync(uploadDir, { recursive: true, force: true });
    uploadDir = '';
  });

  async function setupWithOllama(content: string | Error, loadTranslateSkill?: () => string) {
    db = await openBlogDb(mysqlConfig());
    try {
      await resetBlogTables(db);
      const repo = new PostRepository(db);
      const auth = new AuthService(db, 3_600_000);
      await auth.ensureAdminUser('admin', 'secret123');
      await auth.changePassword('admin', 'secret123', 'secret123');
      uploadDir = mkdtempSync(join(tmpdir(), 'taxalia-admin-'));
      const calls: { system: string; user: string }[] = [];
      const ollama = {
        async chatOnce(args: { system: string; messages: { content: string }[] }) {
          calls.push({ system: args.system, user: args.messages[0]?.content ?? '' });
          if (content instanceof Error) throw content;
          return { content };
        },
        chatStream: () => { throw new Error('not used'); },
        checkModel: async () => {},
      };
      const app = new Hono();
      app.route(
        '/api/admin',
        buildAdminRouter({
          repo, auth, uploadDir, sessionTtlMs: 3_600_000, cookieSecure: false,
          loadTranslateSkill,
          ollama: ollama as never,
        }),
      );
      return { app, calls };
    } catch (error) {
      await closeBlogDb(db);
      throw error;
    }
  }

  const sourcePost = {
    title: 'FBAR 2026: guía',
    slug: 'fbar-2026-guia',
    lang: 'es',
    description: 'Guía sobre FBAR',
    bodyMd: '## Qué es FBAR\n\nContenido.',
    tags: ['FBAR', 'IRS'],
    jsonLd: null,
  };

  it('translates a post via the Ollama skill and returns the proposed fields', async () => {
    const translated = {
      title: 'FBAR 2026: guide',
      slug: 'fbar-2026-guide',
      description: 'Guide about FBAR',
      bodyMd: '## What is FBAR\n\nContent.',
      tags: ['FBAR', 'IRS'],
      jsonLd: '{"@context":"https://schema.org","@type":"FAQPage"}',
    };
    const { app, calls } = await setupWithOllama(JSON.stringify(translated));
    const token = (await login(app))!;

    const res = await app.fetch(
      authed(token, '/api/admin/translate', {
        method: 'POST',
        body: JSON.stringify({ post: sourcePost, targetLang: 'en' }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { post: typeof translated & { lang: string } };
    expect(body.post.lang).toBe('en');
    expect(body.post.title).toBe('FBAR 2026: guide');
    expect(JSON.parse(body.post.jsonLd!)['@type']).toBe('FAQPage');

    // The skill prompt and the source content both reach the model.
    expect(calls).toHaveLength(1);
    expect(calls[0].system.length).toBeGreaterThan(100);
    expect(calls[0].user).toContain('FBAR 2026: guía');
    expect(calls[0].user).toContain('targetLang');
  });

  it('502s when the model returns unparseable output', async () => {
    const { app } = await setupWithOllama('this is not json');
    const token = (await login(app))!;
    const res = await app.fetch(
      authed(token, '/api/admin/translate', {
        method: 'POST',
        body: JSON.stringify({ post: sourcePost, targetLang: 'en' }),
      }),
    );
    expect(res.status).toBe(502);
  });

  it('503s when no Ollama client is configured', async () => {
    let app: Hono;
    ({ app, uploadDir } = await setup());
    const token = (await login(app))!;
    const res = await app.fetch(
      authed(token, '/api/admin/translate', {
        method: 'POST',
        body: JSON.stringify({ post: sourcePost, targetLang: 'en' }),
      }),
    );
    expect(res.status).toBe(503);
  });

  it('returns a clear error when the translate prompt is unavailable', async () => {
    const { app } = await setupWithOllama(JSON.stringify({ title: 'ok' }), () => {
      throw new Error('ENOENT: missing translate prompt');
    });
    const token = (await login(app))!;

    const res = await app.fetch(
      authed(token, '/api/admin/translate', {
        method: 'POST',
        body: JSON.stringify({ post: sourcePost, targetLang: 'en' }),
      }),
    );

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'TRANSLATION_PROMPT_UNAVAILABLE' });
  });
});

describeMySql('first-login password change', () => {
  let app: Hono;
  let uploadDir: string;

  beforeEach(async () => {
    ({ app, uploadDir } = await setup({ firstLoginDone: false }));
  });

  afterEach(() => {
    rmSync(uploadDir, { recursive: true, force: true });
  });

  async function loginRaw(password: string): Promise<Response> {
    return app.fetch(
      new Request('http://x/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password }),
      }),
    );
  }

  it('reports mustChangePassword on first login', async () => {
    const res = await loginRaw('secret123');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { mustChangePassword: boolean };
    expect(body.mustChangePassword).toBe(true);
  });

  it('blocks content endpoints until the password is changed', async () => {
    const token = (await login(app))!;

    const posts = await app.fetch(authed(token, '/api/admin/posts'));
    expect(posts.status).toBe(403);
    const body = (await posts.json()) as { error: string };
    expect(body.error).toBe('PASSWORD_CHANGE_REQUIRED');

    const me = await app.fetch(authed(token, '/api/admin/me'));
    expect(me.status).toBe(200);
  });

  it('changes the password, unblocks the panel, and invalidates the old one', async () => {
    const token = (await login(app))!;

    const change = await app.fetch(
      authed(token, '/api/admin/password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: 'secret123', newPassword: 'brand-new-pass-1' }),
      }),
    );
    expect(change.status).toBe(200);

    const posts = await app.fetch(authed(token, '/api/admin/posts'));
    expect(posts.status).toBe(200);

    expect((await loginRaw('secret123')).status).toBe(401);
    const fresh = await loginRaw('brand-new-pass-1');
    expect(fresh.status).toBe(200);
    const body = (await fresh.json()) as { mustChangePassword: boolean };
    expect(body.mustChangePassword).toBe(false);
  });

  it('rejects a wrong current password and a short new password', async () => {
    const token = (await login(app))!;

    const wrongCurrent = await app.fetch(
      authed(token, '/api/admin/password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: 'nope', newPassword: 'brand-new-pass-1' }),
      }),
    );
    expect(wrongCurrent.status).toBe(401);

    const weak = await app.fetch(
      authed(token, '/api/admin/password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: 'secret123', newPassword: 'short' }),
      }),
    );
    expect(weak.status).toBe(400);
  });
});
