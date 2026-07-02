import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Hono } from 'hono';
import { buildAdminRouter, SESSION_COOKIE } from '../../src/admin/routes.js';

describe('admin translation prompt handling', () => {
  let uploadDir = '';

  afterEach(() => {
    if (uploadDir) {
      rmSync(uploadDir, { recursive: true, force: true });
      uploadDir = '';
    }
  });

  it('returns a clear error and logs when the prompt is missing', async () => {
    uploadDir = mkdtempSync(join(tmpdir(), 'taxalia-admin-'));
    const logger = { error: vi.fn() };
    const auth = {
      validate: vi.fn(async () => 'admin'),
      mustChangePassword: vi.fn(async () => false),
      login: vi.fn(),
      logout: vi.fn(),
      changePassword: vi.fn(),
      ensureAdminUser: vi.fn(),
    };
    const ollama = {
      chatOnce: vi.fn(),
      chatStream: vi.fn(),
      checkModel: vi.fn(),
    };

    const app = new Hono();
    app.route(
      '/api/admin',
      buildAdminRouter({
        repo: {} as never,
        auth: auth as never,
        uploadDir,
        sessionTtlMs: 3_600_000,
        cookieSecure: false,
        logger: logger as never,
        loadTranslateSkill: () => {
          throw new Error('ENOENT: missing translate prompt');
        },
        ollama: ollama as never,
      }),
    );

    const res = await app.fetch(
      new Request('http://x/api/admin/translate', {
        method: 'POST',
        headers: {
          Cookie: `${SESSION_COOKIE}=token`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          post: {
            title: 'FBAR 2026: guía',
            slug: 'fbar-2026-guia',
            lang: 'es',
            description: 'Guía sobre FBAR',
            bodyMd: '## Qué es FBAR\n\nContenido.',
            tags: ['FBAR', 'IRS'],
            jsonLd: null,
          },
          targetLang: 'en',
        }),
      }),
    );

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'TRANSLATION_PROMPT_UNAVAILABLE' });
    expect(logger.error).toHaveBeenCalledOnce();
    expect(auth.validate).toHaveBeenCalled();
  });
});
