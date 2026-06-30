import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { requestIdMiddleware } from '../../src/observability/requestId.js';
import { buildContactRouter } from '../../src/contact/routes.js';

function makeApp(sendSubmission?: unknown) {
  const app = new Hono();
  app.use('*', requestIdMiddleware);
  app.route('/', buildContactRouter({ sendSubmission: sendSubmission as never }));
  return app;
}

describe('POST /contact', () => {
  it('accepts a valid submission and invokes the mail sender', async () => {
    const sendSubmission = vi.fn().mockResolvedValue(undefined);
    const app = makeApp(sendSubmission);

    const res = await app.request('http://test/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Ana López',
        email: 'ana@example.com',
        message: 'I would like help with my U.S. tax filing.',
        lang: 'es',
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; requestId: string };
    expect(body.ok).toBe(true);
    expect(body.requestId).toBeTruthy();
    expect(sendSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Ana López',
        email: 'ana@example.com',
        message: 'I would like help with my U.S. tax filing.',
        lang: 'es',
        requestId: expect.any(String),
      }),
    );
  });

  it('rejects malformed submissions with a 400 envelope', async () => {
    const app = makeApp(vi.fn().mockResolvedValue(undefined));

    const res = await app.request('http://test/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'A',
        email: 'not-an-email',
        message: 'hi',
      }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string; requestId: string } };
    expect(body.error.code).toMatch(/INVALID_|BAD_REQUEST/);
    expect(body.error.requestId).toBeTruthy();
  });

  it('returns 502 when the sender fails', async () => {
    const sendSubmission = vi.fn().mockRejectedValue(new Error('SMTP unavailable'));
    const app = makeApp(sendSubmission);

    const res = await app.request('http://test/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Ana López',
        email: 'ana@example.com',
        message: 'I would like help with my U.S. tax filing.',
        lang: 'es',
      }),
    });

    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('CONTACT_SEND_FAILED');
  });
});
