import type { Context } from 'hono';
import { getRequestId } from '../observability/requestId.js';
import type {
  DeltaEvent,
  DoneEnvelope,
  ErrorEnvelope,
  SSEEvent,
} from './schemas.js';

export function errorEnvelope(
  c: Context,
  code: string,
  message: string,
): ErrorEnvelope {
  return {
    error: {
      code,
      message,
      requestId: getRequestId(c),
    },
  };
}

export function sseFormat(event: SSEEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export function deltaEvent(delta: string): DeltaEvent {
  return { delta };
}

export function sseHeaders(): Record<string, string> {
  return {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  };
}

export type { DoneEnvelope };
