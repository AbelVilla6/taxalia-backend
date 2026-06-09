import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';

export type BlogDatabase = Database.Database;

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
      UNIQUE (slug, lang)
    );

    CREATE INDEX IF NOT EXISTS idx_posts_lang_pubdate
      ON posts (lang, draft, pub_date DESC);

    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      salt          TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
  `);

  return db;
}
