import { z } from 'zod';

const EnvSchema = z.object({
  OLLAMA_HOST: z.string().url().default('http://127.0.0.1:11434'),
  PORT: z.coerce.number().int().positive().default(4324),
  OLLAMA_AGENT_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  CORS_ALLOWED_ORIGINS: z
    .string()
    .default('http://localhost:4321,http://localhost:4322'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  DISPATCH_CONCURRENCY_CAP: z.coerce.number().int().positive().default(2),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export function corsAllowlist(env: Env): string[] {
  return env.CORS_ALLOWED_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
