import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';

describe('loadConfig', () => {
  it('defaults Ollama host to local Ollama outside production', () => {
    expect(loadConfig({ NODE_ENV: 'development' }).OLLAMA_HOST).toBe(
      'http://127.0.0.1:11434/api',
    );
  });

  it('defaults Ollama host to ollama.com in production', () => {
    expect(loadConfig({ NODE_ENV: 'production' }).OLLAMA_HOST).toBe(
      'https://ollama.com/api',
    );
  });

  it('preserves an explicit /api suffix from OLLAMA_HOST', () => {
    expect(loadConfig({ OLLAMA_HOST: 'https://ollama.com/api' }).OLLAMA_HOST).toBe(
      'https://ollama.com/api',
    );
  });
});
