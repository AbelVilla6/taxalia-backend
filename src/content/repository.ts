import type { BlogDatabase } from './db.js';
import { renderPostHtml } from './markdown.js';
import type { Lang, Post, PostDetail, PostSummary } from './schema.js';

interface PostRow {
  id: number;
  slug: string;
  lang: Lang;
  translation_key: string;
  title: string;
  description: string;
  body_md: string;
  body_html: string;
  author: string;
  hero_image: string | null;
  hero_alt: string | null;
  tags: string;
  draft: number;
  pub_date: string;
  updated_date: string | null;
}

/** Full post record including id and raw Markdown, for the admin panel. */
export interface AdminPost {
  id: number;
  slug: string;
  lang: Lang;
  translationKey: string;
  title: string;
  description: string;
  bodyMd: string;
  author: string;
  heroImage: string | null;
  heroAlt: string | null;
  tags: string[];
  draft: boolean;
  pubDate: string;
  updatedDate: string | null;
}

function toAdmin(row: PostRow): AdminPost {
  return {
    id: row.id,
    slug: row.slug,
    lang: row.lang,
    translationKey: row.translation_key,
    title: row.title,
    description: row.description,
    bodyMd: row.body_md,
    author: row.author,
    heroImage: row.hero_image,
    heroAlt: row.hero_alt,
    tags: JSON.parse(row.tags) as string[],
    draft: row.draft === 1,
    pubDate: row.pub_date,
    updatedDate: row.updated_date,
  };
}

function toSummary(row: PostRow): PostSummary {
  return {
    slug: row.slug,
    lang: row.lang,
    translationKey: row.translation_key,
    title: row.title,
    description: row.description,
    author: row.author,
    heroImage: row.hero_image,
    heroAlt: row.hero_alt,
    tags: JSON.parse(row.tags) as string[],
    pubDate: row.pub_date,
    updatedDate: row.updated_date,
  };
}

/**
 * Data-access layer for blog posts. Wraps prepared statements over the SQLite
 * connection so routes stay thin. Markdown is rendered to HTML at write time
 * and stored in `body_html`, so reads never re-parse.
 */
export class PostRepository {
  constructor(private readonly db: BlogDatabase) {}

  /** Published posts for one language, newest first. */
  list(lang: Lang): PostSummary[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM posts
         WHERE lang = ? AND draft = 0
         ORDER BY pub_date DESC`,
      )
      .all(lang) as PostRow[];

    return rows.map(toSummary);
  }

  /** A single published post (with rendered HTML) by slug + language. */
  get(slug: string, lang: Lang): PostDetail | null {
    const row = this.db
      .prepare(
        `SELECT * FROM posts
         WHERE slug = ? AND lang = ? AND draft = 0
         LIMIT 1`,
      )
      .get(slug, lang) as PostRow | undefined;

    if (!row) return null;

    return { ...toSummary(row), contentHtml: row.body_html };
  }

  /** Inserts or replaces a post, rendering its Markdown to HTML. */
  upsert(post: Post): void {
    this.db
      .prepare(
        `INSERT INTO posts
           (slug, lang, translation_key, title, description, body_md, body_html,
            author, hero_image, hero_alt, tags, draft, pub_date, updated_date)
         VALUES
           (@slug, @lang, @translationKey, @title, @description, @bodyMd, @bodyHtml,
            @author, @heroImage, @heroAlt, @tags, @draft, @pubDate, @updatedDate)
         ON CONFLICT (slug, lang) DO UPDATE SET
           translation_key = excluded.translation_key,
           title           = excluded.title,
           description     = excluded.description,
           body_md         = excluded.body_md,
           body_html       = excluded.body_html,
           author          = excluded.author,
           hero_image      = excluded.hero_image,
           hero_alt        = excluded.hero_alt,
           tags            = excluded.tags,
           draft           = excluded.draft,
           pub_date        = excluded.pub_date,
           updated_date    = excluded.updated_date`,
      )
      .run({
        slug: post.slug,
        lang: post.lang,
        translationKey: post.translationKey,
        title: post.title,
        description: post.description,
        bodyMd: post.bodyMd,
        bodyHtml: renderPostHtml(post.bodyMd),
        author: post.author,
        heroImage: post.heroImage ?? null,
        heroAlt: post.heroAlt ?? null,
        tags: JSON.stringify(post.tags),
        draft: post.draft ? 1 : 0,
        pubDate: post.pubDate,
        updatedDate: post.updatedDate ?? null,
      });
  }

  // ---- Admin (all languages, includes drafts) ----

  /** All posts (any language, including drafts), newest first. */
  listAll(): AdminPost[] {
    const rows = this.db
      .prepare(`SELECT * FROM posts ORDER BY pub_date DESC, id DESC`)
      .all() as PostRow[];
    return rows.map(toAdmin);
  }

  /** A single post by id (including draft + raw Markdown). */
  getById(id: number): AdminPost | null {
    const row = this.db
      .prepare(`SELECT * FROM posts WHERE id = ? LIMIT 1`)
      .get(id) as PostRow | undefined;
    return row ? toAdmin(row) : null;
  }

  /** Creates a new post, rendering its Markdown. Returns the new id. */
  create(post: Post): number {
    const result = this.db
      .prepare(
        `INSERT INTO posts
           (slug, lang, translation_key, title, description, body_md, body_html,
            author, hero_image, hero_alt, tags, draft, pub_date, updated_date)
         VALUES
           (@slug, @lang, @translationKey, @title, @description, @bodyMd, @bodyHtml,
            @author, @heroImage, @heroAlt, @tags, @draft, @pubDate, @updatedDate)`,
      )
      .run(this.toParams(post));
    return Number(result.lastInsertRowid);
  }

  /** Updates an existing post by id. Returns false if no row matched. */
  updateById(id: number, post: Post): boolean {
    const result = this.db
      .prepare(
        `UPDATE posts SET
           slug = @slug, lang = @lang, translation_key = @translationKey,
           title = @title, description = @description, body_md = @bodyMd,
           body_html = @bodyHtml, author = @author, hero_image = @heroImage,
           hero_alt = @heroAlt, tags = @tags, draft = @draft,
           pub_date = @pubDate, updated_date = @updatedDate
         WHERE id = @id`,
      )
      .run({ ...this.toParams(post), id });
    return result.changes > 0;
  }

  /** Deletes a post by id. Returns false if no row matched. */
  removeById(id: number): boolean {
    const result = this.db.prepare(`DELETE FROM posts WHERE id = ?`).run(id);
    return result.changes > 0;
  }

  private toParams(post: Post): Record<string, unknown> {
    return {
      slug: post.slug,
      lang: post.lang,
      translationKey: post.translationKey,
      title: post.title,
      description: post.description,
      bodyMd: post.bodyMd,
      bodyHtml: renderPostHtml(post.bodyMd),
      author: post.author,
      heroImage: post.heroImage ?? null,
      heroAlt: post.heroAlt ?? null,
      tags: JSON.stringify(post.tags),
      draft: post.draft ? 1 : 0,
      pubDate: post.pubDate,
      updatedDate: post.updatedDate ?? null,
    };
  }

  /** Total row count — used to decide whether to seed an empty database. */
  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM posts').get() as {
      n: number;
    };
    return row.n;
  }
}
