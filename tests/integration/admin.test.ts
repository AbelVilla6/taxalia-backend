import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Hono } from 'hono';
import { openBlogDb } from '../../src/content/db.js';
import { PostRepository } from '../../src/content/repository.js';
import { AuthService } from '../../src/admin/auth.js';
import { buildAdminRouter, SESSION_COOKIE } from '../../src/admin/routes.js';

function setup() {
  const db = openBlogDb(':memory:');
  const repo = new PostRepository(db);
  const auth = new AuthService(db, 3_600_000);
  auth.ensureAdminUser('admin', 'secret123');
  const uploadDir = mkdtempSync(join(tmpdir(), 'taxalia-admin-'));
  const app = new Hono();
  app.route(
    '/api/admin',
    buildAdminRouter({ repo, auth, uploadDir, sessionTtlMs: 3_600_000, cookieSecure: false }),
  );
  return { app, repo, uploadDir };
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

describe('admin API', () => {
  let app: Hono;
  let uploadDir: string;

  beforeEach(() => {
    ({ app, uploadDir } = setup());
  });

  afterEach(() => {
    rmSync(uploadDir, { recursive: true, force: true });
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
      title: 'Nuevo', slug: 'nuevo', lang: 'es', translationKey: 'nuevo',
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
          title: 'Editado', slug: 'nuevo', lang: 'es', translationKey: 'nuevo',
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
      title: 'A', slug: 'dup', lang: 'es', translationKey: 'dup',
      description: '', bodyMd: '', pubDate: '2026-01-01', draft: false,
    });
    expect((await app.fetch(authed(token, '/api/admin/posts', { method: 'POST', body }))).status).toBe(201);
    expect((await app.fetch(authed(token, '/api/admin/posts', { method: 'POST', body }))).status).toBe(409);
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
