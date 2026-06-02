import { streamSSE } from 'hono/streaming';
import { Hono, type Context } from 'hono';
import { runChatPipeline, type ChatRouteDeps } from './dispatch.js';
import type { ArtifactRegistry } from '../loaders/registry.js';
import { snapshot } from '../observability/metrics.js';
import { getRequestId } from '../observability/requestId.js';
import { getDefaultLogger, type Logger } from '../observability/logger.js';
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
    const requestId = getRequestId(c);
    const baseLogger = deps?.logger ?? getDefaultLogger();
    const reqLogger: Logger = baseLogger.child({
      requestId,
      route: 'POST /chat',
    });
    const startedAt = performance.now();
    reqLogger.info(
      {
        stage: 'received',
        origin: c.req.header('Origin') ?? null,
        userAgent: c.req.header('User-Agent') ?? null,
        contentType: c.req.header('Content-Type') ?? null,
      },
      'chat request received',
    );

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      reqLogger.warn({ stage: 'parse', code: 'BAD_REQUEST' }, 'body is not valid JSON');
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
      reqLogger.warn(
        { stage: 'validate', code, path, issue: issue?.message },
        'request failed schema validation',
      );
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
      reqLogger.warn(
        { stage: 'validate', code: 'EMPTY_MESSAGE' },
        'last user message is empty/whitespace',
      );
      return c.json(
        errorEnvelope(c, 'EMPTY_MESSAGE', 'Last user message is empty.'),
        400,
      );
    }

    reqLogger.info(
      {
        stage: 'parsed',
        lang: parsed.data.lang,
        messageCount: parsed.data.messages.length,
        sessionId: parsed.data.sessionId ?? null,
        lastUserChars: last.content.length,
      },
      'chat request parsed',
    );

    if (!deps || !registry) {
      reqLogger.error(
        { stage: 'wiring', code: 'NOT_IMPLEMENTED' },
        'chat dispatch is not wired',
      );
      return c.json(
        errorEnvelope(
          c,
          'NOT_IMPLEMENTED',
          'Chat dispatch is not yet wired (PR3/PR4). Skeleton accepts the request envelope.',
        ),
        501,
      );
    }

    c.header('X-Accel-Buffering', 'no');

    const pipelineRunner = deps.pipelineOverride ?? runChatPipeline;
    let pipeline;
    const preflightStart = performance.now();
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
        logger: reqLogger,
      });
    } catch (err) {
      const preflightMs = Math.round(performance.now() - preflightStart);
      if (err instanceof PipelineError) {
        reqLogger.warn(
          {
            stage: 'preflight-failed',
            code: err.code,
            status: err.status,
            preflightMs,
            totalMs: Math.round(performance.now() - startedAt),
          },
          'pipeline preflight rejected',
        );
        return c.json(
          errorEnvelope(c, err.code, err.message),
          err.status as 400 | 500 | 503,
        );
      }
      reqLogger.error(
        {
          stage: 'preflight-failed',
          preflightMs,
          totalMs: Math.round(performance.now() - startedAt),
          err: err instanceof Error
            ? { name: err.name, message: err.message }
            : { message: String(err) },
        },
        'pipeline pre-stream failure (unexpected)',
      );
      return c.json(
        errorEnvelope(
          c,
          'INTERNAL_ERROR',
          err instanceof Error ? err.message : 'Pipeline failed.',
        ),
        500,
      );
    }

    reqLogger.info(
      {
        stage: 'stream-open',
        preflightMs: Math.round(performance.now() - preflightStart),
      },
      'opening SSE stream',
    );

    return streamSSE(c, async (stream) => {
      let frames = 0;
      let sawDone = false;
      stream.onAbort(() => {
        reqLogger.warn(
          {
            stage: 'stream-abort',
            frames,
            totalMs: Math.round(performance.now() - startedAt),
          },
          'SSE stream aborted by client',
        );
      });

      try {
        for await (const event of pipeline.events) {
          if (stream.aborted) return;
          await stream.writeSSE({ data: JSON.stringify(event satisfies SSEEvent) });
          frames += 1;
          if ('done' in event && event.done) {
            sawDone = true;
            reqLogger.info(
              {
                stage: 'stream-done',
                frames,
                totalMs: Math.round(performance.now() - startedAt),
                agents: event.agents?.map((a) => ({
                  id: a.id,
                  status: a.status,
                  ms: a.durationMs,
                })),
                warning: event.warning,
              },
              'SSE stream completed',
            );
            return;
          }
        }
        if (!sawDone) {
          reqLogger.warn(
            {
              stage: 'stream-end-no-done',
              frames,
              totalMs: Math.round(performance.now() - startedAt),
            },
            'pipeline iterator ended without a done event',
          );
        }
      } catch (err) {
        if (stream.aborted) return;
        const code =
          (err as { code?: string } | null)?.code ?? 'STREAM_ERROR';
        const message = err instanceof Error ? err.message : 'Stream error.';
        reqLogger.error(
          {
            stage: 'stream-error',
            code,
            frames,
            totalMs: Math.round(performance.now() - startedAt),
            err: err instanceof Error
              ? { name: err.name, message: err.message }
              : { message: String(err) },
          },
          'SSE stream error (mid-stream)',
        );
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
