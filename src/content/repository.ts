import type { BlogDatabase } from './db.js';
import { execute, queryOne } from './db.js';
import { renderPostHtml } from './markdown.js';
import type {
  AlternateLink,
  ArticleJsonLd,
  Lang,
  Post,
  PostDetail,
  PostSummary,
  SeoData,
  TocEntry,
} from './schema.js';

interface PostRow {
  id: number;
  slug: string;
  lang: Lang;
  translation_group_id: string;
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
  meta_title: string | null;
  meta_description: string | null;
  focus_keyword: string | null;
  secondary_keywords: string;
  open_graph_image: string | null;
  open_graph_title: string | null;
  open_graph_description: string | null;
  toc_json: string;
  json_ld: string | null;
  group_published: number;
}

async function queryRows<T>(
  db: BlogDatabase,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const [rows] = await db.query(sql, params);
  return rows as T[];
}

/** Full post record including id and raw Markdown, for the admin panel. */
export interface AdminPost {
  id: number;
  slug: string;
  lang: Lang;
  translationGroupId: string;
  title: string;
  description: string;
  bodyMd: string;
  author: string;
  heroImage: string | null;
  heroAlt: string | null;
  tags: string[];
  draft: boolean;
  published: boolean;
  pubDate: string;
  updatedDate: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  focusKeyword: string | null;
  secondaryKeywords: string[];
  openGraphImage: string | null;
  openGraphTitle: string | null;
  openGraphDescription: string | null;
  jsonLd: string | null;
}

function parseJsonArray<T>(value: string, fallback: T[] = []): T[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}

function normalizeSiteUrl(siteUrl: string): string {
  return siteUrl.replace(/\/+$/, '') || 'http://localhost:4321';
}

function articlePath(lang: Lang, slug: string): string {
  return lang === 'es' ? `/es/blog/${slug}` : `/blog/${slug}`;
}

function articleUrl(siteUrl: string, lang: Lang, slug: string): string {
  return `${normalizeSiteUrl(siteUrl)}${articlePath(lang, slug)}`;
}

function uniqueKeywords(...groups: Array<Array<string | null | undefined>>): string[] {
  const keywords = new Set<string>();
  for (const group of groups) {
    for (const keyword of group) {
      if (keyword) keywords.add(keyword);
    }
  }

  return [...keywords];
}

function rowTranslationGroupId(row: Pick<PostRow, 'translation_group_id' | 'translation_key'>): string {
  return row.translation_group_id || row.translation_key;
}

function rowTags(row: Pick<PostRow, 'tags'>): string[] {
  return parseJsonArray<string>(row.tags);
}

function rowSecondaryKeywords(row: Pick<PostRow, 'secondary_keywords'>): string[] {
  return parseJsonArray<string>(row.secondary_keywords);
}

function rowToc(row: Pick<PostRow, 'toc_json'>): TocEntry[] {
  return parseJsonArray<TocEntry>(row.toc_json);
}

function toSeo(row: PostRow, siteUrl: string): SeoData {
  const tags = rowTags(row);
  const metaTitle = row.meta_title ?? row.title;
  const metaDescription = row.meta_description ?? row.description;
  const secondaryKeywords = rowSecondaryKeywords(row);
  const focusKeyword = row.focus_keyword ?? tags[0] ?? null;
  const openGraphImage = row.open_graph_image ?? row.hero_image ?? null;

  return {
    metaTitle,
    metaDescription,
    canonicalUrl: articleUrl(siteUrl, row.lang, row.slug),
    focusKeyword,
    secondaryKeywords: secondaryKeywords.length > 0 ? secondaryKeywords : tags.slice(1),
    openGraphImage,
    openGraphTitle: row.open_graph_title ?? metaTitle,
    openGraphDescription: row.open_graph_description ?? metaDescription,
  };
}

function toJsonLd(row: PostRow, seo: SeoData): ArticleJsonLd {
  const keywords = uniqueKeywords(
    [seo.focusKeyword],
    seo.secondaryKeywords,
    rowTags(row),
  );

  const jsonLd: ArticleJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: seo.metaTitle,
    description: seo.metaDescription,
    author: { '@type': 'Organization', name: row.author },
    datePublished: row.pub_date,
    dateModified: row.updated_date ?? row.pub_date,
    keywords,
    inLanguage: row.lang,
    mainEntityOfPage: seo.canonicalUrl,
    url: seo.canonicalUrl,
  };

  if (seo.openGraphImage) {
    jsonLd.image = [seo.openGraphImage];
  }

  return jsonLd;
}

function toAdmin(row: PostRow): AdminPost {
  return {
    id: row.id,
    slug: row.slug,
    lang: row.lang,
    translationGroupId: rowTranslationGroupId(row),
    title: row.title,
    description: row.description,
    bodyMd: row.body_md,
    author: row.author,
    heroImage: row.hero_image,
    heroAlt: row.hero_alt,
    tags: rowTags(row),
    draft: row.draft === 1,
    published: row.group_published === 1,
    pubDate: row.pub_date,
    updatedDate: row.updated_date,
    metaTitle: row.meta_title,
    metaDescription: row.meta_description,
    focusKeyword: row.focus_keyword,
    secondaryKeywords: rowSecondaryKeywords(row),
    openGraphImage: row.open_graph_image,
    openGraphTitle: row.open_graph_title,
    openGraphDescription: row.open_graph_description,
    jsonLd: row.json_ld,
  };
}

function toSummary(row: PostRow): PostSummary {
  return {
    slug: row.slug,
    lang: row.lang,
    translationGroupId: rowTranslationGroupId(row),
    published: row.group_published === 1,
    title: row.title,
    description: row.description,
    author: row.author,
    heroImage: row.hero_image,
    heroAlt: row.hero_alt,
    tags: rowTags(row),
    pubDate: row.pub_date,
    updatedDate: row.updated_date,
  };
}

function toPostDetail(row: PostRow, siteUrl: string, relatedRows: PostRow[]): PostDetail {
  const seo = toSeo(row, siteUrl);
  const alternates = Object.fromEntries(
    relatedRows.map((related) => [
      related.lang,
      {
        slug: related.slug,
        url: articleUrl(siteUrl, related.lang, related.slug),
      },
    ]),
  ) as Partial<Record<Lang, AlternateLink>>;
  const { html: contentHtml, toc } = renderPostHtml(row.body_md);
  const storedToc = rowToc(row);

  let customJsonLd: Record<string, unknown> | null = null;
  if (row.json_ld) {
    try {
      const parsed = JSON.parse(row.json_ld) as unknown;
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        customJsonLd = parsed as Record<string, unknown>;
      }
    } catch {
      // Invalid stored JSON-LD is dropped from the public payload.
    }
  }

  return {
    ...toSummary(row),
    alternates,
    seo,
    toc: storedToc.length > 0 ? storedToc : toc,
    articleJsonLd: toJsonLd(row, seo),
    customJsonLd,
    contentHtml,
  };
}

function selectColumns(): string {
  return `
    p.id,
    p.slug,
    p.lang,
    p.translation_group_id,
    p.translation_key,
    p.title,
    p.description,
    p.body_md,
    p.body_html,
    p.author,
    p.hero_image,
    p.hero_alt,
    p.tags,
    p.draft,
    p.pub_date,
    p.updated_date,
    p.meta_title,
    p.meta_description,
    p.focus_keyword,
    p.secondary_keywords,
    p.open_graph_image,
    p.open_graph_title,
    p.open_graph_description,
    p.toc_json,
    p.json_ld,
    COALESCE(g.published, CASE WHEN p.draft = 0 THEN 1 ELSE 0 END) AS group_published
  `;
}

function toParams(post: Post): Record<string, unknown> {
  const rendered = renderPostHtml(post.bodyMd);

  return {
    slug: post.slug,
    lang: post.lang,
    translationGroupId: post.translationGroupId,
    translationKey: post.translationGroupId,
    title: post.title,
    description: post.description,
    bodyMd: post.bodyMd,
    bodyHtml: rendered.html,
    author: post.author,
    heroImage: post.heroImage ?? null,
    heroAlt: post.heroAlt ?? null,
    tags: JSON.stringify(post.tags),
    draft: post.draft ? 1 : 0,
    pubDate: post.pubDate,
    updatedDate: post.updatedDate ?? null,
    metaTitle: post.metaTitle ?? null,
    metaDescription: post.metaDescription ?? null,
    focusKeyword: post.focusKeyword ?? null,
    secondaryKeywords: JSON.stringify(post.secondaryKeywords ?? []),
    openGraphImage: post.openGraphImage ?? null,
    openGraphTitle: post.openGraphTitle ?? null,
    openGraphDescription: post.openGraphDescription ?? null,
    tocJson: JSON.stringify(rendered.toc),
    jsonLd: post.jsonLd || null,
  };
}

/**
 * Data-access layer for blog posts. Wraps prepared statements over the MySQL
 * connection so routes stay thin. Markdown is rendered to HTML at write time
 * and stored in `body_html`, so reads never re-parse.
 */
export class PostRepository {
  constructor(
    private readonly db: BlogDatabase,
    private readonly frontendSiteUrl = 'http://localhost:4321',
  ) {}

  /** Published posts for one language, newest first. */
  async list(lang: Lang): Promise<PostSummary[]> {
    const rows = await queryRows<PostRow>(
      this.db,
      `SELECT ${selectColumns()} FROM posts p
       INNER JOIN translation_groups g ON g.id = p.translation_group_id
       WHERE p.lang = ? AND g.published = 1
       ORDER BY p.pub_date DESC, p.id DESC`,
      [lang],
    );

    return rows.map(toSummary);
  }

  /** A single published post (with rendered HTML) by slug + language. */
  async get(slug: string, lang: Lang): Promise<PostDetail | null> {
    const row = await queryOne<PostRow & { group_published: number }>(
      this.db,
      `SELECT ${selectColumns()} FROM posts p
       INNER JOIN translation_groups g ON g.id = p.translation_group_id
       WHERE p.slug = ? AND p.lang = ? AND g.published = 1
       LIMIT 1`,
      [slug, lang],
    );

    if (!row) return null;

    const relatedRows = await queryRows<PostRow>(
      this.db,
      `SELECT ${selectColumns()} FROM posts p
       INNER JOIN translation_groups g ON g.id = p.translation_group_id
       WHERE p.translation_group_id = ? AND g.published = 1
       ORDER BY p.lang`,
      [rowTranslationGroupId(row)],
    );

    return toPostDetail(row, this.frontendSiteUrl, relatedRows);
  }

  /** Inserts or replaces a post, rendering its Markdown to HTML. */
  async upsert(post: Post): Promise<void> {
    const params = toParams(post);
    const existing = await queryOne<{ translation_group_id: string }>(
      this.db,
      `SELECT translation_group_id FROM posts WHERE slug = ? AND lang = ? LIMIT 1`,
      [post.slug, post.lang],
    );

    await execute(
      this.db,
      `INSERT INTO posts
         (slug, lang, translation_group_id, translation_key, title, description, body_md, body_html,
          author, hero_image, hero_alt, tags, draft, pub_date, updated_date,
          meta_title, meta_description, focus_keyword, secondary_keywords,
          open_graph_image, open_graph_title, open_graph_description, toc_json, json_ld)
       VALUES
         (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         translation_group_id = VALUES(translation_group_id),
         translation_key = VALUES(translation_key),
         title = VALUES(title),
         description = VALUES(description),
         body_md = VALUES(body_md),
         body_html = VALUES(body_html),
         author = VALUES(author),
         hero_image = VALUES(hero_image),
         hero_alt = VALUES(hero_alt),
         tags = VALUES(tags),
         draft = VALUES(draft),
         pub_date = VALUES(pub_date),
         updated_date = VALUES(updated_date),
         meta_title = VALUES(meta_title),
         meta_description = VALUES(meta_description),
         focus_keyword = VALUES(focus_keyword),
         secondary_keywords = VALUES(secondary_keywords),
         open_graph_image = VALUES(open_graph_image),
         open_graph_title = VALUES(open_graph_title),
         open_graph_description = VALUES(open_graph_description),
         toc_json = VALUES(toc_json),
         json_ld = VALUES(json_ld)`,
      [
        post.slug,
        post.lang,
        post.translationGroupId,
        post.translationGroupId,
        post.title,
        post.description,
        post.bodyMd,
        params.bodyHtml,
        post.author,
        post.heroImage ?? null,
        post.heroAlt ?? null,
        JSON.stringify(post.tags),
        post.draft ? 1 : 0,
        post.pubDate,
        post.updatedDate ?? null,
        post.metaTitle ?? null,
        post.metaDescription ?? null,
        post.focusKeyword ?? null,
        JSON.stringify(post.secondaryKeywords ?? []),
        post.openGraphImage ?? null,
        post.openGraphTitle ?? null,
        post.openGraphDescription ?? null,
        params.tocJson,
        post.jsonLd || null,
      ],
    );

    await this.syncTranslationGroup(post.translationGroupId, post.draft);
    if (existing && existing.translation_group_id !== post.translationGroupId) {
      await this.refreshTranslationGroup(existing.translation_group_id);
    }
  }

  // ---- Admin (all languages, includes drafts) ----

  /** All posts (any language, including drafts), newest first. */
  async listAll(): Promise<AdminPost[]> {
    const rows = await queryRows<PostRow>(
      this.db,
      `SELECT ${selectColumns()} FROM posts p
       LEFT JOIN translation_groups g ON g.id = p.translation_group_id
       ORDER BY p.pub_date DESC, p.id DESC`,
    );
    return rows.map(toAdmin);
  }

  /** A single post by id (including draft + raw Markdown). */
  async getById(id: number): Promise<AdminPost | null> {
    const row = await queryOne<PostRow>(
      this.db,
      `SELECT ${selectColumns()} FROM posts p
       LEFT JOIN translation_groups g ON g.id = p.translation_group_id
       WHERE p.id = ?
       LIMIT 1`,
      [id],
    );
    return row ? toAdmin(row) : null;
  }

  /** Creates a new post, rendering its Markdown. Returns the new id. */
  async create(post: Post): Promise<number> {
    const params = toParams(post);
    const result = await execute(
      this.db,
      `INSERT INTO posts
         (slug, lang, translation_group_id, translation_key, title, description, body_md, body_html,
          author, hero_image, hero_alt, tags, draft, pub_date, updated_date,
          meta_title, meta_description, focus_keyword, secondary_keywords,
          open_graph_image, open_graph_title, open_graph_description, toc_json, json_ld)
       VALUES
         (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        post.slug,
        post.lang,
        post.translationGroupId,
        post.translationGroupId,
        post.title,
        post.description,
        post.bodyMd,
        params.bodyHtml,
        post.author,
        post.heroImage ?? null,
        post.heroAlt ?? null,
        JSON.stringify(post.tags),
        post.draft ? 1 : 0,
        post.pubDate,
        post.updatedDate ?? null,
        post.metaTitle ?? null,
        post.metaDescription ?? null,
        post.focusKeyword ?? null,
        JSON.stringify(post.secondaryKeywords ?? []),
        post.openGraphImage ?? null,
        post.openGraphTitle ?? null,
        post.openGraphDescription ?? null,
        params.tocJson,
        post.jsonLd || null,
      ],
    );

    await this.syncTranslationGroup(post.translationGroupId, post.draft);
    return Number(result.insertId);
  }

  /** Updates an existing post by id. Returns false if no row matched. */
  async updateById(id: number, post: Post): Promise<boolean> {
    const params = toParams(post);
    const existing = await this.getById(id);
    if (!existing) return false;

    const result = await execute(
      this.db,
      `UPDATE posts SET
         slug = ?, lang = ?, translation_group_id = ?,
         translation_key = ?,
         title = ?, description = ?, body_md = ?,
         body_html = ?, author = ?, hero_image = ?,
         hero_alt = ?, tags = ?, draft = ?,
         pub_date = ?, updated_date = ?,
         meta_title = ?, meta_description = ?,
         focus_keyword = ?, secondary_keywords = ?,
         open_graph_image = ?, open_graph_title = ?,
         open_graph_description = ?, toc_json = ?,
         json_ld = ?
       WHERE id = ?`,
      [
        post.slug,
        post.lang,
        post.translationGroupId,
        post.translationGroupId,
        post.title,
        post.description,
        post.bodyMd,
        params.bodyHtml,
        post.author,
        post.heroImage ?? null,
        post.heroAlt ?? null,
        JSON.stringify(post.tags),
        post.draft ? 1 : 0,
        post.pubDate,
        post.updatedDate ?? null,
        post.metaTitle ?? null,
        post.metaDescription ?? null,
        post.focusKeyword ?? null,
        JSON.stringify(post.secondaryKeywords ?? []),
        post.openGraphImage ?? null,
        post.openGraphTitle ?? null,
        post.openGraphDescription ?? null,
        params.tocJson,
        post.jsonLd || null,
        id,
      ],
    );

    await this.syncTranslationGroup(post.translationGroupId, post.draft);
    if (existing.translationGroupId !== post.translationGroupId) {
      await this.refreshTranslationGroup(existing.translationGroupId);
    }

    return result.affectedRows > 0;
  }

  /** Deletes a post by id. Returns false if no row matched. */
  async removeById(id: number): Promise<boolean> {
    const existing = await this.getById(id);
    if (!existing) return false;

    const result = await execute(this.db, `DELETE FROM posts WHERE id = ?`, [id]);
    await this.refreshTranslationGroup(existing.translationGroupId);
    return result.affectedRows > 0;
  }

  private async syncTranslationGroup(groupId: string, draft: boolean): Promise<void> {
    await execute(
      this.db,
      `INSERT INTO translation_groups (id, published)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE published = VALUES(published)`,
      [groupId, draft ? 0 : 1],
    );

    await execute(this.db, `UPDATE posts SET draft = ? WHERE translation_group_id = ?`, [
      draft ? 1 : 0,
      groupId,
    ]);
  }

  private async refreshTranslationGroup(groupId: string): Promise<void> {
    const rows = await queryRows<{ draft: number }>(
      this.db,
      `SELECT draft FROM posts WHERE translation_group_id = ?`,
      [groupId],
    );

    if (rows.length === 0) {
      await execute(this.db, `DELETE FROM translation_groups WHERE id = ?`, [groupId]);
      return;
    }

    const published = rows.every((row) => row.draft === 0) ? 1 : 0;

    await execute(
      this.db,
      `INSERT INTO translation_groups (id, published)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE published = VALUES(published)`,
      [groupId, published],
    );

    await execute(this.db, `UPDATE posts SET draft = ? WHERE translation_group_id = ?`, [
      published ? 0 : 1,
      groupId,
    ]);
  }

  /** Total row count — used to decide whether to seed an empty database. */
  async count(): Promise<number> {
    const row = await queryOne<{ n: number }>(this.db, 'SELECT COUNT(*) AS n FROM posts');
    return Number(row?.n ?? 0);
  }
}
