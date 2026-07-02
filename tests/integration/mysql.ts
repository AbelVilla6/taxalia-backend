import { describe } from 'vitest';
import type { BlogDatabase, MySqlBlogConfig } from '../../src/content/db.js';

export type MySqlSuiteMode = 'run' | 'skip' | 'fail';

const MYSQL_ENV_REASON =
  'MYSQL_HOST, MYSQL_USER, and MYSQL_DATABASE are required for MySQL integration suites.';

export function resolveMySqlSuiteMode(env: NodeJS.ProcessEnv = process.env): MySqlSuiteMode {
  if (env.MYSQL_HOST && env.MYSQL_USER && env.MYSQL_DATABASE) {
    return 'run';
  }

  return ['1', 'true', 'yes', 'on'].includes((env.CI ?? '').toLowerCase()) ? 'fail' : 'skip';
}

export function describeMySql(name: string, fn: Parameters<typeof describe>[1]) {
  const mode = resolveMySqlSuiteMode();

  if (mode === 'run') {
    return describe(name, fn);
  }

  if (mode === 'fail') {
    return describe(name, () => {
      throw new Error(`CI requires MySQL test env: ${MYSQL_ENV_REASON}`);
    });
  }

  return describe.skip(`${name} (skipped: ${MYSQL_ENV_REASON})`, fn);
}

export function mysqlConfig(): MySqlBlogConfig {
  return {
    host: process.env.MYSQL_HOST ?? '127.0.0.1',
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: process.env.MYSQL_USER ?? 'taxalia',
    password: process.env.MYSQL_PASSWORD ?? '',
    database: process.env.MYSQL_DATABASE ?? 'taxalia_test',
    connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT ?? 1),
    ssl: ['1', 'true', 'yes', 'on'].includes((process.env.MYSQL_SSL ?? '').toLowerCase()),
  };
}

export async function resetBlogTables(db: BlogDatabase): Promise<void> {
  await db.execute('SET FOREIGN_KEY_CHECKS = 0');
  try {
    for (const table of ['sessions', 'users', 'translation_groups', 'posts']) {
      await db.execute(`TRUNCATE TABLE \`${table}\``);
    }
  } finally {
    await db.execute('SET FOREIGN_KEY_CHECKS = 1');
  }
}
