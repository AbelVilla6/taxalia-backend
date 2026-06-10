import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { ensureBlogSchema } from '../../src/content/db.js';

function createLegacyDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE posts (
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
  `);

  db.prepare(
    `INSERT INTO posts
      (slug, lang, translation_key, title, description, body_md, body_html, author, hero_image, hero_alt, tags, draft, pub_date, updated_date)
     VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('published', 'en', 'group-a', 'Published', '', '# Hello', '<h1>Hello</h1>', 'Taxalia', null, null, '[]', 0, '2026-01-01', null);

  db.prepare(
    `INSERT INTO posts
      (slug, lang, translation_key, title, description, body_md, body_html, author, hero_image, hero_alt, tags, draft, pub_date, updated_date)
     VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('draft', 'es', 'group-b', 'Draft', '', '# Hola', '<h1>Hola</h1>', 'Taxalia', null, null, '[]', 1, '2026-01-02', null);

  return db;
}

describe('ensureBlogSchema', () => {
  it('adds translation groups and backfills published groups conservatively', () => {
    const db = createLegacyDb();

    ensureBlogSchema(db);

    const columns = db.prepare('PRAGMA table_info(posts)').all() as { name: string }[];
    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'translation_group_id',
        'meta_title',
        'meta_description',
        'focus_keyword',
        'secondary_keywords',
        'open_graph_image',
        'open_graph_title',
        'open_graph_description',
        'toc_json',
      ]),
    );

    const groups = db
      .prepare('SELECT id, published FROM translation_groups ORDER BY id')
      .all() as { id: string; published: number }[];

    expect(groups).toEqual([
      { id: 'group-a', published: 1 },
      { id: 'group-b', published: 0 },
    ]);

    const rows = db
      .prepare('SELECT slug, translation_group_id FROM posts ORDER BY slug')
      .all() as { slug: string; translation_group_id: string }[];

    expect(rows).toEqual([
      { slug: 'draft', translation_group_id: 'group-b' },
      { slug: 'published', translation_group_id: 'group-a' },
    ]);
  });

  it('keeps fully published groups published', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE posts (
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
    `);
    db.prepare(
      `INSERT INTO posts
        (slug, lang, translation_key, title, description, body_md, body_html, author, hero_image, hero_alt, tags, draft, pub_date, updated_date)
       VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('en-a', 'en', 'group-c', 'A', '', '', '', 'Taxalia', null, null, '[]', 0, '2026-01-03', null);
    db.prepare(
      `INSERT INTO posts
        (slug, lang, translation_key, title, description, body_md, body_html, author, hero_image, hero_alt, tags, draft, pub_date, updated_date)
       VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('es-a', 'es', 'group-c', 'B', '', '', '', 'Taxalia', null, null, '[]', 0, '2026-01-03', null);

    ensureBlogSchema(db);

    const group = db.prepare('SELECT id, published FROM translation_groups WHERE id = ?').get('group-c') as {
      id: string;
      published: number;
    };

    expect(group).toEqual({ id: 'group-c', published: 1 });
  });
});
