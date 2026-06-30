import { z } from 'zod';
import { LangSchema } from '../chat/schemas.js';

export const ContactSubmissionSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254),
  message: z.string().trim().min(10).max(4000),
  lang: LangSchema.optional(),
});

export type ContactSubmission = z.infer<typeof ContactSubmissionSchema>;
