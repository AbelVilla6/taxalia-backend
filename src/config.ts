import { existsSync } from 'node:fs';
import { z } from 'zod';
import { DEFAULT_LOCAL_MODEL, DEFAULT_PRODUCTION_MODEL } from './ollama/models.js';

export const DEFAULT_ADMIN_USERNAME = 'admin';
export const DEFAULT_ADMIN_PASSWORD = 'change-me-now';

const BooleanFromEnvSchema = z.preprocess((value) => {
  if (typeof value === 'string') {
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
  }

  return value;
}, z.boolean());

const EnvSchema = z.object({
  OLLAMA_HOST: z.string().url().optional(),
  OLLAMA_API_KEY: z.string().optional(),
  OLLAMA_MODEL: z.string().optional(),
  PORT: z.coerce.number().int().positive().default(4324),
  OLLAMA_AGENT_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  MYSQL_HOST: z.string().trim().min(1).default('localhost'),
  MYSQL_PORT: z.coerce.number().int().positive().default(3306),
  MYSQL_USER: z.string().trim().min(1),
  MYSQL_PASSWORD: z.string().default(''),
  MYSQL_DATABASE: z.string().trim().min(1),
  MYSQL_CONNECTION_LIMIT: z.coerce.number().int().positive().default(10),
  MYSQL_SSL: BooleanFromEnvSchema.default(false),
  SEED_DEMO_CONTENT: BooleanFromEnvSchema.default(false),
  SMTP_HOST: z.string().trim().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: BooleanFromEnvSchema.default(false),
  SMTP_USER: z.string().trim().min(1).optional(),
  SMTP_PASS: z.string().trim().min(1).optional(),
  CONTACT_EMAIL_TO: z.string().email().default('info@hitaxalia.com'),
  CONTACT_EMAIL_FROM: z
    .string()
    .trim()
    .min(1)
    .default('LB&Co Global Advisors <info@hitaxalia.com>'),
  CONTACT_EMAIL_SUBJECT_PREFIX: z.string().trim().min(1).default('[LB&Co Contact]'),
  CORS_ALLOWED_ORIGINS: z
    .string()
    .default('http://localhost:4321,http://localhost:4322'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  DISPATCH_CONCURRENCY_CAP: z.coerce.number().int().positive().default(2),
  SKIP_OLLAMA_CHECK: z
    .string()
    .optional()
    .transform((v) => v === '1' || v === 'true'),
  ADMIN_USERNAME: z.string().trim().min(1).default(DEFAULT_ADMIN_USERNAME),
  ADMIN_PASSWORD: z.string().trim().min(1).default(DEFAULT_ADMIN_PASSWORD),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),
  UPLOAD_DIR: z.string().default('./data/uploads'),
  CALCOM_URL: z.string().trim().min(1).default('/contact'),
  FRONTEND_SITE_URL: z.string().url().default('http://localhost:4321'),
});

export type Env = Omit<z.infer<typeof EnvSchema>, 'OLLAMA_HOST' | 'OLLAMA_MODEL'> & {
  OLLAMA_HOST: string;
  OLLAMA_MODEL: string;
  // CALCOM_URL is always present (default applied by zod).
};

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Env {
  loadDotEnvIfNeeded(source);

  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  validateProductionAdminCredentials(parsed.data, source.NODE_ENV);
  return {
    ...parsed.data,
    OLLAMA_HOST: parsed.data.OLLAMA_HOST ?? defaultOllamaHost(source.NODE_ENV),
    OLLAMA_MODEL: parsed.data.OLLAMA_MODEL ?? defaultOllamaModel(source.NODE_ENV),
  };
}

function loadDotEnvIfNeeded(source: NodeJS.ProcessEnv): void {
  if (source !== process.env) return;
  if (!existsSync('.env')) return;
  if (typeof process.loadEnvFile !== 'function') return;

  process.loadEnvFile('.env');
}

function defaultOllamaHost(nodeEnv: string | undefined): string {
  return nodeEnv === 'production'
    ? 'https://ollama.com/api'
    : 'http://127.0.0.1:11434/api';
}

function defaultOllamaModel(nodeEnv: string | undefined): string {
  return nodeEnv === 'production' ? DEFAULT_PRODUCTION_MODEL : DEFAULT_LOCAL_MODEL;
}

export function validateProductionAdminCredentials(
  env: Pick<Env, 'ADMIN_USERNAME' | 'ADMIN_PASSWORD'>,
  nodeEnv: string | undefined,
): void {
  if (nodeEnv !== 'production') return;

  const issues: string[] = [];
  if (env.ADMIN_USERNAME === DEFAULT_ADMIN_USERNAME) {
    issues.push('ADMIN_USERNAME must be set to a non-default value in production');
  }
  if (env.ADMIN_PASSWORD === DEFAULT_ADMIN_PASSWORD) {
    issues.push('ADMIN_PASSWORD must be set to a non-default value in production');
  }

  if (issues.length > 0) {
    throw new Error(`Invalid environment configuration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
  }
}

export function corsAllowlist(env: Env): string[] {
  return env.CORS_ALLOWED_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
