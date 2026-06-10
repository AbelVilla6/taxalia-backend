import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';

describe('loadConfig', () => {
  it('defaults Ollama host to local Ollama outside production', () => {
    expect(loadConfig({ NODE_ENV: 'development' }).OLLAMA_HOST).toBe(
      'http://127.0.0.1:11434/api',
    );
  });

  it('defaults Ollama model to gemma4:e4b outside production', () => {
    expect(loadConfig({ NODE_ENV: 'development' }).OLLAMA_MODEL).toBe('gemma4:e4b');
  });

  it('defaults Ollama host to ollama.com in production', () => {
    expect(loadConfig({ NODE_ENV: 'production' }).OLLAMA_HOST).toBe(
      'https://ollama.com/api',
    );
  });

  it('defaults Ollama model to gemma4:31b-cloud in production', () => {
    expect(loadConfig({ NODE_ENV: 'production' }).OLLAMA_MODEL).toBe(
      'gemma4:31b-cloud',
    );
  });

  it('preserves an explicit /api suffix from OLLAMA_HOST', () => {
    expect(loadConfig({ OLLAMA_HOST: 'https://ollama.com/api' }).OLLAMA_HOST).toBe(
      'https://ollama.com/api',
    );
  });

  it('preserves an explicit OLLAMA_MODEL override', () => {
    expect(loadConfig({ OLLAMA_MODEL: 'custom-model' }).OLLAMA_MODEL).toBe(
      'custom-model',
    );
  });

  it('defaults the contact recipient to info@hitaxalia.com', () => {
    expect(loadConfig({}).CONTACT_EMAIL_TO).toBe('info@hitaxalia.com');
  });

  it('defaults CALCOM_URL to https://cal.com/taxalia', () => {
    expect(loadConfig({}).CALCOM_URL).toBe('https://cal.com/taxalia');
  });

  it('accepts a custom CALCOM_URL override', () => {
    expect(loadConfig({ CALCOM_URL: 'https://cal.com/my-firm' }).CALCOM_URL).toBe(
      'https://cal.com/my-firm',
    );
  });
});
