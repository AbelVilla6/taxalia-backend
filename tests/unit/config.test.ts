import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';

describe('loadConfig', () => {
  it('defaults Ollama host to local Ollama outside production', () => {
    expect(loadConfig({ NODE_ENV: 'development' }).OLLAMA_HOST).toBe(
      'http://127.0.0.1:11434',
    );
  });

  it('defaults Ollama host to ollama.com in production', () => {
    expect(loadConfig({ NODE_ENV: 'production' }).OLLAMA_HOST).toBe(
      'https://ollama.com',
    );
  });

  it('normalizes an explicit /api suffix because ollama-js appends it', () => {
    expect(loadConfig({ OLLAMA_HOST: 'https://ollama.com/api' }).OLLAMA_HOST).toBe(
      'https://ollama.com',
    );
  });
});
