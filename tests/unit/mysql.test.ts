import { describe, expect, it } from 'vitest';
import { resolveMySqlSuiteMode } from '../integration/mysql.js';

describe('resolveMySqlSuiteMode', () => {
  it('runs when all required MySQL env vars are present', () => {
    expect(
      resolveMySqlSuiteMode({
        MYSQL_HOST: '127.0.0.1',
        MYSQL_USER: 'taxalia',
        MYSQL_DATABASE: 'taxalia_test',
      } as NodeJS.ProcessEnv),
    ).toBe('run');
  });

  it('fails in CI when required MySQL env vars are missing', () => {
    expect(resolveMySqlSuiteMode({ CI: 'true' } as NodeJS.ProcessEnv)).toBe('fail');
  });

  it('skips locally when required MySQL env vars are missing', () => {
    expect(resolveMySqlSuiteMode({} as NodeJS.ProcessEnv)).toBe('skip');
  });
});
