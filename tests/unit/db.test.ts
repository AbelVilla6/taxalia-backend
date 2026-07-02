import { describe, expect, it } from 'vitest';
import { ensureBlogSchema, mysqlConfigFromEnv, openBlogDb, type BlogDatabase } from '../../src/content/db.js';

const MYSQL_ENV = {
  MYSQL_HOST: '127.0.0.1',
  MYSQL_PORT: 3306,
  MYSQL_USER: 'taxalia',
  MYSQL_PASSWORD: '',
  MYSQL_DATABASE: 'taxalia_test',
  MYSQL_CONNECTION_LIMIT: 1,
  MYSQL_SSL: false,
} as const;

const MYSQL_CONFIG = {
  host: MYSQL_ENV.MYSQL_HOST,
  port: MYSQL_ENV.MYSQL_PORT,
  user: MYSQL_ENV.MYSQL_USER,
  password: MYSQL_ENV.MYSQL_PASSWORD,
  database: MYSQL_ENV.MYSQL_DATABASE,
  connectionLimit: MYSQL_ENV.MYSQL_CONNECTION_LIMIT,
  ssl: MYSQL_ENV.MYSQL_SSL,
} as const;

function makeFakeDb() {
  const calls: Array<{ kind: 'query' | 'execute'; sql: string; params: unknown[] }> = [];

  const db = {
    async execute(sql: string, params: unknown[] = []) {
      calls.push({ kind: 'execute', sql, params });
      return [{} as never, undefined as never] as const;
    },
    async query(sql: string, params: unknown[] = []) {
      calls.push({ kind: 'query', sql, params });
      const normalized = sql.replace(/\s+/g, ' ').trim();
      const emptyRows = [] as never[];

      if (normalized.includes('FROM information_schema.COLUMNS')) {
        return [emptyRows, undefined as never] as const;
      }

      if (normalized.includes('FROM information_schema.STATISTICS')) {
        return [emptyRows, undefined as never] as const;
      }

      if (normalized.includes('SELECT translation_group_id AS id')) {
        return [[
          { id: 'group-a', has_draft: 0 },
          { id: 'group-b', has_draft: 1 },
        ] as never[], undefined as never] as const;
      }

      return [emptyRows, undefined as never] as const;
    },
  } as unknown as BlogDatabase;

  return { db, calls };
}

describe('mysqlConfigFromEnv', () => {
  it('maps env values to pool options without rewriting credentials', () => {
    expect(mysqlConfigFromEnv(MYSQL_ENV)).toEqual({
      host: '127.0.0.1',
      port: 3306,
      user: 'taxalia',
      password: '',
      database: 'taxalia_test',
      connectionLimit: 1,
      ssl: false,
    });
  });
});

describe('openBlogDb', () => {
  it('rejects blank MYSQL_USER before opening a pool', async () => {
    await expect(
      openBlogDb({ ...MYSQL_CONFIG, user: '   ' }),
    ).rejects.toThrow('MYSQL_USER is required');
  });

  it('rejects blank MYSQL_DATABASE before opening a pool', async () => {
    await expect(
      openBlogDb({ ...MYSQL_CONFIG, database: '  ' }),
    ).rejects.toThrow('MYSQL_DATABASE is required');
  });
});

describe('ensureBlogSchema', () => {
  it('creates tables, backfills migration columns, and syncs translation groups', async () => {
    const { db, calls } = makeFakeDb();

    await ensureBlogSchema(db);

    const executedSql = calls.filter((call) => call.kind === 'execute').map((call) => call.sql);
    expect(executedSql.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS posts'))).toBe(true);
    expect(executedSql.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS users'))).toBe(true);
    expect(executedSql.some((sql) => sql.includes('ALTER TABLE `posts` ADD COLUMN `json_ld` LONGTEXT NULL'))).toBe(true);
    expect(executedSql.some((sql) => sql.includes('ALTER TABLE `posts` ADD INDEX `idx_posts_lang_pubdate` (lang, draft, pub_date DESC)'))).toBe(true);
    expect(executedSql.some((sql) => sql.includes('UPDATE posts'))).toBe(true);

    const translationGroupCalls = calls.filter(
      (call) =>
        call.kind === 'execute' &&
        call.sql.startsWith('INSERT INTO translation_groups (id, published)'),
    );
    expect(translationGroupCalls).toHaveLength(2);
    expect(translationGroupCalls[0]?.params).toEqual(['group-a', 1]);
    expect(translationGroupCalls[1]?.params).toEqual(['group-b', 0]);
  });
});
