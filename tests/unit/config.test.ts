import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';

const MYSQL_ENV = {
  MYSQL_HOST: '127.0.0.1',
  MYSQL_PORT: 3306,
  MYSQL_USER: 'taxalia',
  MYSQL_PASSWORD: '',
  MYSQL_DATABASE: 'taxalia_test',
  MYSQL_CONNECTION_LIMIT: 1,
  MYSQL_SSL: false,
} as const;

const PROD_ADMIN_ENV = {
  ADMIN_USERNAME: 'ops-admin',
  ADMIN_PASSWORD: 'strong-password-123',
} as const;

describe('loadConfig', () => {
  it('defaults Ollama host to local Ollama outside production', () => {
    expect(loadConfig({ ...MYSQL_ENV, NODE_ENV: 'development' }).OLLAMA_HOST).toBe(
      'http://127.0.0.1:11434/api',
    );
  });

  it('defaults Ollama model to gemma4:e4b outside production', () => {
    expect(loadConfig({ ...MYSQL_ENV, NODE_ENV: 'development' }).OLLAMA_MODEL).toBe('gemma4:e4b');
  });

  it('defaults Ollama host to ollama.com in production', () => {
    expect(loadConfig({ ...MYSQL_ENV, ...PROD_ADMIN_ENV, NODE_ENV: 'production' }).OLLAMA_HOST).toBe(
      'https://ollama.com/api',
    );
  });

  it('defaults Ollama model to gemma4:31b-cloud in production', () => {
    expect(loadConfig({ ...MYSQL_ENV, ...PROD_ADMIN_ENV, NODE_ENV: 'production' }).OLLAMA_MODEL).toBe(
      'gemma4:31b-cloud',
    );
  });

  it('preserves an explicit /api suffix from OLLAMA_HOST', () => {
    expect(loadConfig({ ...MYSQL_ENV, OLLAMA_HOST: 'https://ollama.com/api' }).OLLAMA_HOST).toBe(
      'https://ollama.com/api',
    );
  });

  it('preserves an explicit OLLAMA_MODEL override', () => {
    expect(loadConfig({ ...MYSQL_ENV, OLLAMA_MODEL: 'custom-model' }).OLLAMA_MODEL).toBe(
      'custom-model',
    );
  });

  it('defaults the contact recipient to info@hitaxalia.com', () => {
    expect(loadConfig(MYSQL_ENV).CONTACT_EMAIL_TO).toBe('info@hitaxalia.com');
  });

  it('defaults CALCOM_URL to /contact', () => {
    expect(loadConfig(MYSQL_ENV).CALCOM_URL).toBe('/contact');
  });

  it('accepts a custom CALCOM_URL override', () => {
    expect(loadConfig({ ...MYSQL_ENV, CALCOM_URL: 'https://example.com/contact' }).CALCOM_URL).toBe(
      'https://example.com/contact',
    );
  });

  it('defaults the frontend site URL for canonical links', () => {
    expect(loadConfig(MYSQL_ENV).FRONTEND_SITE_URL).toBe('http://localhost:4321');
  });

  it('defaults demo seeding off', () => {
    expect(loadConfig(MYSQL_ENV).SEED_DEMO_CONTENT).toBe(false);
  });

  it('accepts explicit demo seeding opt-in', () => {
    expect(loadConfig({ ...MYSQL_ENV, SEED_DEMO_CONTENT: 'true' }).SEED_DEMO_CONTENT).toBe(true);
  });

  it('rejects the default admin username in production', () => {
    expect(() =>
      loadConfig({
        ...MYSQL_ENV,
        NODE_ENV: 'production',
        ADMIN_USERNAME: 'admin',
        ADMIN_PASSWORD: PROD_ADMIN_ENV.ADMIN_PASSWORD,
      }),
    ).toThrow(/ADMIN_USERNAME/);
  });

  it('rejects the default admin password in production', () => {
    expect(() =>
      loadConfig({
        ...MYSQL_ENV,
        NODE_ENV: 'production',
        ADMIN_USERNAME: PROD_ADMIN_ENV.ADMIN_USERNAME,
        ADMIN_PASSWORD: 'change-me-now',
      }),
    ).toThrow(/ADMIN_PASSWORD/);
  });
});
