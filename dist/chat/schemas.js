import { z } from 'zod';
export const LangSchema = z.enum(['en', 'es']);
export const RoleSchema = z.enum(['user', 'assistant', 'system']);
export const MessageSchema = z.object({
    role: RoleSchema,
    content: z.string(),
});
export const ChatRequestSchema = z.object({
    messages: z.array(MessageSchema).min(1),
    lang: LangSchema,
    sessionId: z.string().uuid().optional(),
});
export const DeltaEventSchema = z.object({
    delta: z.string().min(1),
});
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
export const DoneEnvelopeSchema = z.object({
    done: z.literal(true),
    agentResponse: z.boolean(),
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
export const ErrorEnvelopeSchema = z.object({
    error: z.object({
        code: z.string(),
        message: z.string(),
        requestId: z.string(),
    }),
});
