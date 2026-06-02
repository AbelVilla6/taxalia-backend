import { z } from 'zod';

export const LangSchema = z.enum(['en', 'es']);
export type Lang = z.infer<typeof LangSchema>;

export const RoleSchema = z.enum(['user', 'assistant', 'system']);

export const MessageSchema = z.object({
  role: RoleSchema,
  content: z.string(),
});
export type Message = z.infer<typeof MessageSchema>;

export const ChatRequestSchema = z.object({
  messages: z.array(MessageSchema).min(1),
  lang: LangSchema,
  sessionId: z.string().uuid().optional(),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export const DeltaEventSchema = z.object({
  delta: z.string().min(1),
});
export type DeltaEvent = z.infer<typeof DeltaEventSchema>;

export const AgentResultSchema = z.object({
  id: z.string(),
  status: z.enum(['ok', 'error']),
  text: z.string().optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string().optional(),
    })
    .optional(),
  durationMs: z.number().int().nonnegative(),
});
export type AgentResult = z.infer<typeof AgentResultSchema>;

export const DoneEnvelopeSchema = z.object({
  done: z.literal(true),
  agents: z.array(AgentResultSchema),
  warning: z.string().optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string().optional(),
    })
    .optional(),
  requestId: z.string(),
});
export type DoneEnvelope = z.infer<typeof DoneEnvelopeSchema>;

export const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
  }),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;

export type SSEEvent = DeltaEvent | DoneEnvelope;
