import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';

export type BlogDatabase = Database.Database;

const POST_COLUMNS = [
  ['translation_group_id', "TEXT NOT NULL DEFAULT ''"],
  ['meta_title', 'TEXT'],
  ['meta_description', 'TEXT'],
  ['focus_keyword', 'TEXT'],
  ['secondary_keywords', "TEXT NOT NULL DEFAULT '[]'"],
  ['open_graph_image', 'TEXT'],
  ['open_graph_title', 'TEXT'],
  ['open_graph_description', 'TEXT'],
  ['toc_json', "TEXT NOT NULL DEFAULT '[]'"],
] as const;

/**
 * Opens (and lazily creates) the blog content database at `dbPath`.
 *
 * In production this file lives on a persistent volume of the backend host;
 * locally it defaults to ./data/blog.db. The schema is created on first open
 * so a fresh host/volume bootstraps itself.
 */
export function openBlogDb(dbPath: string): BlogDatabase {
  const inMemory = dbPath === ':memory:';
  let target = dbPath;

  if (!inMemory) {
    target = resolve(dbPath);
    const dir = dirname(target);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  const db = new Database(target);
  if (!inMemory) db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS posts (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      slug            TEXT NOT NULL,
      lang            TEXT NOT NULL CHECK (lang IN ('en', 'es')),
      translation_key TEXT NOT NULL,
      translation_group_id TEXT NOT NULL DEFAULT '',
      title           TEXT NOT NULL,
      description     TEXT NOT NULL DEFAULT '',
      body_md         TEXT NOT NULL DEFAULT '',
      body_html       TEXT NOT NULL DEFAULT '',
      author          TEXT NOT NULL DEFAULT 'Taxalia',
      hero_image      TEXT,
      hero_alt        TEXT,
      tags            TEXT NOT NULL DEFAULT '[]',
      draft           INTEGER NOT NULL DEFAULT 0,
      pub_date        TEXT NOT NULL,
      updated_date    TEXT,
      meta_title      TEXT,
      meta_description TEXT,
      focus_keyword   TEXT,
      secondary_keywords TEXT NOT NULL DEFAULT '[]',
      open_graph_image TEXT,
      open_graph_title TEXT,
      open_graph_description TEXT,
      toc_json        TEXT NOT NULL DEFAULT '[]',
      UNIQUE (slug, lang)
    );

    CREATE INDEX IF NOT EXISTS idx_posts_lang_pubdate
      ON posts (lang, draft, pub_date DESC);

    CREATE TABLE IF NOT EXISTS translation_groups (
      id TEXT PRIMARY KEY,
      published INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_translation_groups_published
      ON translation_groups (published);

    CREATE TABLE IF NOT EXISTS users (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      username             TEXT NOT NULL UNIQUE,
      password_hash        TEXT NOT NULL,
      salt                 TEXT NOT NULL,
      must_change_password INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
  `);

  ensureBlogSchema(db);

  return db;
}

export function ensureBlogSchema(db: BlogDatabase): void {
  for (const [column, definition] of POST_COLUMNS) {
    const exists = db
      .prepare(`PRAGMA table_info(posts)`)
      .all()
      .some((row) => (row as { name: string }).name === column);

    if (!exists) {
      db.exec(`ALTER TABLE posts ADD COLUMN ${column} ${definition}`);
    }
  }

  // users may not exist yet (openBlogDb creates it after this runs on legacy
  // fixtures); an empty PRAGMA result means there is nothing to migrate.
  const userColumns = db.prepare(`PRAGMA table_info(users)`).all() as { name: string }[];
  if (
    userColumns.length > 0 &&
    !userColumns.some((row) => row.name === 'must_change_password')
  ) {
    db.exec(`ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0`);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS translation_groups (
      id TEXT PRIMARY KEY,
      published INTEGER NOT NULL DEFAULT 0
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_posts_translation_group_id
      ON posts (translation_group_id);

    CREATE INDEX IF NOT EXISTS idx_translation_groups_published
      ON translation_groups (published);
  `);

  db.prepare(
    `UPDATE posts
     SET translation_group_id = translation_key
     WHERE translation_group_id = '' OR translation_group_id IS NULL`,
  ).run();

  const groups = db
    .prepare(
      `SELECT translation_group_id AS id, MAX(draft) AS has_draft
       FROM posts
       WHERE translation_group_id IS NOT NULL AND translation_group_id != ''
       GROUP BY translation_group_id`,
    )
    .all() as { id: string; has_draft: number }[];

  const insertGroup = db.prepare(
    `INSERT OR IGNORE INTO translation_groups (id, published)
     VALUES (?, ?)`,
  );

  for (const group of groups) {
    insertGroup.run(group.id, group.has_draft === 0 ? 1 : 0);
  }
}
