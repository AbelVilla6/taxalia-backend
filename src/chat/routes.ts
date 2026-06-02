import { Hono, type Context } from 'hono';
import type { ArtifactRegistry } from '../loaders/registry.js';
import { snapshot } from '../observability/metrics.js';
import { getRequestId } from '../observability/requestId.js';
import { errorEnvelope } from './sse.js';
import {
  ChatRequestSchema,
  type Lang,
  type Message,
} from './schemas.js';

const HEALTH_MODEL = 'gemma4:e4b';

function isWhitespace(s: string): boolean {
  return s.trim().length === 0;
}

function lastUserMessage(messages: Message[]): Message | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return messages[i];
  }
  return undefined;
}

export function buildChatRouter(registry?: ArtifactRegistry): Hono {
  const app = new Hono();

  app.get('/health', (c: Context) => {
    return c.json({ ok: true, model: HEALTH_MODEL });
  });

  app.get('/metrics', (c: Context) => {
    return c.json({ counters: snapshot() });
  });

  app.post('/admin/reload', async (c: Context) => {
    if (process.env.NODE_ENV === 'production') {
      return c.notFound();
    }

    if (!registry) {
      return c.json(
        errorEnvelope(c, 'RELOAD_UNAVAILABLE', 'Artifact registry is not configured.'),
        500,
      );
    }

    try {
      const next = await registry.reload();
      return c.json({
        ok: true,
        counts: {
          agents: next.agents.length,
          skills: next.skills.length,
          conducta: next.conducta.length,
        },
        requestId: getRequestId(c),
      });
    } catch (error) {
      return c.json(
        errorEnvelope(
          c,
          'RELOAD_FAILED',
          error instanceof Error ? error.message : 'Reload failed.',
        ),
        500,
      );
    }
  });

  app.post('/chat', async (c: Context) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json(
        errorEnvelope(c, 'BAD_REQUEST', 'Request body is not valid JSON.'),
        400,
      );
    }

    const parsed = ChatRequestSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const path = issue?.path.join('.') ?? 'body';
      const code =
        path === 'lang' ? 'UNSUPPORTED_LANG' : 'BAD_REQUEST';
      return c.json(
        errorEnvelope(
          c,
          code,
          `Invalid request: ${path} ${issue?.message ?? 'is invalid'}.`,
        ),
        400,
      );
    }

    const last = lastUserMessage(parsed.data.messages);
    if (!last || isWhitespace(last.content)) {
      return c.json(
        errorEnvelope(c, 'EMPTY_MESSAGE', 'Last user message is empty.'),
        400,
      );
    }

    // Loaders and orchestrator land in PR3/PR4. Surface 501 to confirm
    // the wire contract is wired (Zod accepted, lang valid, content non-empty)
    // before the dispatch pipeline is implemented.
    return c.json(
      {
        error: {
          code: 'NOT_IMPLEMENTED',
          message:
            'Chat dispatch is not yet wired (PR3/PR4). Skeleton accepts the request envelope.',
          requestId: getRequestId(c),
        },
        lang: parsed.data.lang satisfies Lang,
      },
      501,
    );
  });

  return app;
}
