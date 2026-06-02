import { streamSSE } from 'hono/streaming';
import { Hono, type Context } from 'hono';
import { runChatPipeline, type ChatRouteDeps } from './dispatch.js';
import type { ArtifactRegistry } from '../loaders/registry.js';
import { snapshot } from '../observability/metrics.js';
import { getRequestId } from '../observability/requestId.js';
import { errorEnvelope } from './sse.js';
import {
  ChatRequestSchema,
  type Lang,
  type Message,
  type SSEEvent,
} from './schemas.js';
import { PipelineError } from './errors.js';

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

export function buildChatRouter(
  registry?: ArtifactRegistry,
  deps?: ChatRouteDeps,
): Hono {
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
      const code = path === 'lang' ? 'UNSUPPORTED_LANG' : 'BAD_REQUEST';
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

    if (!deps || !registry) {
      return c.json(
        errorEnvelope(
          c,
          'NOT_IMPLEMENTED',
          'Chat dispatch is not yet wired (PR3/PR4). Skeleton accepts the request envelope.',
        ),
        501,
      );
    }

    const requestId = getRequestId(c);
    c.header('X-Accel-Buffering', 'no');

    const pipelineRunner = deps.pipelineOverride ?? runChatPipeline;
    let pipeline;
    try {
      pipeline = await pipelineRunner({
        request: parsed.data,
        requestId,
        signal: c.req.raw.signal,
        client: deps.client,
        semaphore: deps.semaphore,
        agentTimeoutMs: deps.agentTimeoutMs,
        coldStart: deps.coldStart,
        registry,
      });
    } catch (err) {
      if (err instanceof PipelineError) {
        return c.json(
          errorEnvelope(c, err.code, err.message),
          err.status as 400 | 500 | 503,
        );
      }
      console.error('chat pipeline pre-stream failure', err);
      return c.json(
        errorEnvelope(
          c,
          'INTERNAL_ERROR',
          err instanceof Error ? err.message : 'Pipeline failed.',
        ),
        500,
      );
    }

    return streamSSE(c, async (stream) => {
      stream.onAbort(() => {
        // c.req.raw.signal already propagates; nothing else to do.
      });

      try {
        for await (const event of pipeline.events) {
          if (stream.aborted) return;
          await stream.writeSSE({ data: JSON.stringify(event satisfies SSEEvent) });
          if ('done' in event && event.done) return;
        }
      } catch (err) {
        if (stream.aborted) return;
        const code =
          (err as { code?: string } | null)?.code ?? 'STREAM_ERROR';
        const message = err instanceof Error ? err.message : 'Stream error.';
        await stream.writeSSE({
          data: JSON.stringify({
            done: true,
            agents: [],
            error: { code, message },
            requestId,
          } satisfies SSEEvent),
        });
      }
    });
  });

  return app;
}
