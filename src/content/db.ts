import { createPool, type Pool, type PoolOptions, type ResultSetHeader } from 'mysql2/promise';

export interface MySqlBlogConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  connectionLimit: number;
  ssl: boolean;
}

export type BlogDatabase = Pool;

export interface MySqlEnvLike {
  MYSQL_HOST: string;
  MYSQL_PORT: number;
  MYSQL_USER: string;
  MYSQL_PASSWORD: string;
  MYSQL_DATABASE: string;
  MYSQL_CONNECTION_LIMIT: number;
  MYSQL_SSL: boolean;
}

const POSTS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS posts (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    slug VARCHAR(191) NOT NULL,
    lang VARCHAR(2) NOT NULL,
    translation_key VARCHAR(191) NOT NULL,
    translation_group_id VARCHAR(191) NOT NULL DEFAULT '',
    title VARCHAR(255) NOT NULL,
    description LONGTEXT NOT NULL,
    body_md LONGTEXT NOT NULL,
    body_html LONGTEXT NOT NULL,
    author VARCHAR(255) NOT NULL,
    hero_image LONGTEXT NULL,
    hero_alt LONGTEXT NULL,
    tags LONGTEXT NOT NULL,
    draft TINYINT(1) NOT NULL DEFAULT 0,
    pub_date VARCHAR(32) NOT NULL,
    updated_date VARCHAR(32) NULL,
    meta_title VARCHAR(255) NULL,
    meta_description LONGTEXT NULL,
    focus_keyword VARCHAR(255) NULL,
    secondary_keywords LONGTEXT NOT NULL,
    open_graph_image LONGTEXT NULL,
    open_graph_title VARCHAR(255) NULL,
    open_graph_description LONGTEXT NULL,
    toc_json LONGTEXT NOT NULL,
    json_ld LONGTEXT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_posts_slug_lang (slug, lang)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const TRANSLATION_GROUPS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS translation_groups (
    id VARCHAR(191) NOT NULL,
    published TINYINT(1) NOT NULL DEFAULT 0,
    PRIMARY KEY (id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const USERS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    username VARCHAR(191) NOT NULL,
    password_hash LONGTEXT NOT NULL,
    salt LONGTEXT NOT NULL,
    must_change_password TINYINT(1) NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE KEY uq_users_username (username)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const SESSIONS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS sessions (
    token VARCHAR(128) NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    expires_at BIGINT NOT NULL,
    PRIMARY KEY (token),
    KEY idx_sessions_user_id (user_id),
    CONSTRAINT fk_sessions_user_id
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const POST_ALTER_COLUMNS: Array<[string, string]> = [
  ['translation_group_id', "VARCHAR(191) NOT NULL DEFAULT ''"],
  ['meta_title', 'VARCHAR(255) NULL'],
  ['meta_description', 'LONGTEXT NULL'],
  ['focus_keyword', 'VARCHAR(255) NULL'],
  ['secondary_keywords', 'LONGTEXT NOT NULL'],
  ['open_graph_image', 'LONGTEXT NULL'],
  ['open_graph_title', 'VARCHAR(255) NULL'],
  ['open_graph_description', 'LONGTEXT NULL'],
  ['toc_json', 'LONGTEXT NOT NULL'],
  ['json_ld', 'LONGTEXT NULL'],
] as const;

export function mysqlConfigFromEnv(env: MySqlEnvLike): MySqlBlogConfig {
  return {
    host: env.MYSQL_HOST,
    port: env.MYSQL_PORT,
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD,
    database: env.MYSQL_DATABASE,
    connectionLimit: env.MYSQL_CONNECTION_LIMIT,
    ssl: env.MYSQL_SSL,
  };
}

export async function openBlogDb(config: MySqlBlogConfig): Promise<BlogDatabase> {
  if (!config.host.trim()) {
    throw new Error('MYSQL_HOST is required');
  }
  if (!config.user.trim()) {
    throw new Error('MYSQL_USER is required');
  }
  if (!config.database.trim()) {
    throw new Error('MYSQL_DATABASE is required');
  }

  const pool = createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    connectionLimit: config.connectionLimit,
    ssl: config.ssl ? {} : undefined,
    waitForConnections: true,
    namedPlaceholders: false,
  } satisfies PoolOptions);

  await ensureBlogSchema(pool);
  return pool;
}

export async function ensureBlogSchema(db: BlogDatabase): Promise<void> {
  await db.execute(POSTS_TABLE_SQL);
  await db.execute(TRANSLATION_GROUPS_TABLE_SQL);
  await db.execute(USERS_TABLE_SQL);
  await db.execute(SESSIONS_TABLE_SQL);

  for (const [column, definition] of POST_ALTER_COLUMNS) {
    await ensureColumn(db, 'posts', column, definition);
  }

  await ensureColumn(db, 'users', 'must_change_password', 'TINYINT(1) NOT NULL DEFAULT 0');

  await ensureIndex(db, 'posts', 'idx_posts_lang_pubdate', '(lang, draft, pub_date DESC)');
  await ensureIndex(db, 'posts', 'idx_posts_translation_group_id', '(translation_group_id)');
  await ensureIndex(db, 'translation_groups', 'idx_translation_groups_published', '(published)');

  await db.execute(
    `UPDATE posts
     SET translation_group_id = translation_key
     WHERE translation_group_id = '' OR translation_group_id IS NULL`,
  );

  const [groupRows] = (await db.query(
    `SELECT translation_group_id AS id, MAX(draft) AS has_draft
     FROM posts
     WHERE translation_group_id IS NOT NULL AND translation_group_id != ''
     GROUP BY translation_group_id`,
  )) as [Array<{ id: string; has_draft: number }>, unknown];

  for (const group of groupRows as Array<{ id: string; has_draft: number }>) {
    await db.execute(
      `INSERT INTO translation_groups (id, published)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE published = VALUES(published)`,
      [group.id, group.has_draft === 0 ? 1 : 0],
    );
  }
}

async function ensureColumn(
  db: BlogDatabase,
  table: string,
  column: string,
  definition: string,
): Promise<void> {
  const [rows] = (await db.query(
    `SELECT 1
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
     LIMIT 1`,
    [table, column],
  )) as [Array<unknown>, unknown];

  if (rows.length > 0) return;

  await db.execute(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
}

async function ensureIndex(
  db: BlogDatabase,
  table: string,
  indexName: string,
  definition: string,
): Promise<void> {
  const [rows] = (await db.query(
    `SELECT 1
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND INDEX_NAME = ?
     LIMIT 1`,
    [table, indexName],
  )) as [Array<unknown>, unknown];

  if (rows.length > 0) return;

  await db.execute(`ALTER TABLE \`${table}\` ADD INDEX \`${indexName}\` ${definition}`);
}

export async function closeBlogDb(db: BlogDatabase): Promise<void> {
  await db.end();
}

export async function queryOne<T>(
  db: BlogDatabase,
  sql: string,
  params: any[] = [],
): Promise<T | null> {
  const [rows] = (await db.query(sql, params)) as [Array<Record<string, unknown>>, unknown];
  return (rows[0] ?? null) as T | null;
}

export async function execute(db: BlogDatabase, sql: string, params: any[] = []): Promise<ResultSetHeader> {
  const [result] = await db.execute<ResultSetHeader>(sql, params);
  return result;
}
