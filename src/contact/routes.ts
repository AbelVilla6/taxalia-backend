import { Hono, type Context } from 'hono';
import { errorEnvelope } from '../chat/sse.js';
import { getDefaultLogger, type Logger } from '../observability/logger.js';
import { getRequestId } from '../observability/requestId.js';
import { ContactMailerConfigError, type ContactSender } from './mail.js';
import { ContactSubmissionSchema } from './schemas.js';

export interface ContactRouteDeps {
  sendSubmission?: ContactSender;
  logger?: Logger;
}

function validationErrorCode(issuePath: string): string {
  if (issuePath === 'email') return 'INVALID_EMAIL';
  if (issuePath === 'name') return 'INVALID_NAME';
  if (issuePath === 'message') return 'INVALID_MESSAGE';
  return 'BAD_REQUEST';
}

export function buildContactRouter(deps: ContactRouteDeps = {}): Hono {
  const app = new Hono();

  app.post('/contact', async (c: Context) => {
    const requestId = getRequestId(c);
    const logger = deps.logger ?? getDefaultLogger();

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json(errorEnvelope(c, 'BAD_REQUEST', 'Request body is not valid JSON.'), 400);
    }

    const parsed = ContactSubmissionSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const path = issue?.path.join('.') || 'body';
      const code = validationErrorCode(path);

      return c.json(
        errorEnvelope(c, code, `Invalid request: ${path} ${issue?.message ?? 'is invalid'}.`),
        400,
      );
    }

    if (!deps.sendSubmission) {
      return c.json(
        errorEnvelope(
          c,
          'CONTACT_MAILER_NOT_CONFIGURED',
          'Contact form delivery is not configured on this server.',
        ),
        503,
      );
    }

    try {
      await deps.sendSubmission({ ...parsed.data, requestId });
      logger.info(
        {
          route: 'POST /contact',
          requestId,
          email: parsed.data.email,
          name: parsed.data.name,
          lang: parsed.data.lang ?? 'en',
          messageLength: parsed.data.message.length,
        },
        'contact form submitted',
      );

      return c.json({ ok: true, requestId });
    } catch (err) {
      logger.error(
        {
          route: 'POST /contact',
          requestId,
          err,
        },
        'contact form delivery failed',
      );

      if (err instanceof ContactMailerConfigError) {
        return c.json(errorEnvelope(c, err.code, err.message), 503);
      }

      return c.json(
        errorEnvelope(
          c,
          'CONTACT_SEND_FAILED',
          'We could not send your message right now. Please try again later.',
        ),
        502,
      );
    }
  });

  return app;
}
