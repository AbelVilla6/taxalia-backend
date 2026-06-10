import type { BlogDatabase } from './db.js';
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
 * Data-access layer for blog posts. Wraps prepared statements over the SQLite
 * connection so routes stay thin. Markdown is rendered to HTML at write time
 * and stored in `body_html`, so reads never re-parse.
 */
export class PostRepository {
  constructor(
    private readonly db: BlogDatabase,
    private readonly frontendSiteUrl = 'http://localhost:4321',
  ) {}

  /** Published posts for one language, newest first. */
  list(lang: Lang): PostSummary[] {
    const rows = this.db
      .prepare(
        `SELECT ${selectColumns()} FROM posts p
         INNER JOIN translation_groups g ON g.id = p.translation_group_id
         WHERE p.lang = ? AND g.published = 1
         ORDER BY p.pub_date DESC, p.id DESC`,
      )
      .all(lang) as PostRow[];

    return rows.map(toSummary);
  }

  /** A single published post (with rendered HTML) by slug + language. */
  get(slug: string, lang: Lang): PostDetail | null {
    const row = this.db
      .prepare(
        `SELECT ${selectColumns()} FROM posts p
         INNER JOIN translation_groups g ON g.id = p.translation_group_id
         WHERE p.slug = ? AND p.lang = ? AND g.published = 1
         LIMIT 1`,
      )
      .get(slug, lang) as PostRow | undefined;

    if (!row) return null;

    const relatedRows = this.db
      .prepare(
        `SELECT ${selectColumns()} FROM posts p
         INNER JOIN translation_groups g ON g.id = p.translation_group_id
         WHERE p.translation_group_id = ? AND g.published = 1
         ORDER BY p.lang`,
      )
      .all(rowTranslationGroupId(row)) as PostRow[];

    return toPostDetail(row, this.frontendSiteUrl, relatedRows);
  }

  /** Inserts or replaces a post, rendering its Markdown to HTML. */
  upsert(post: Post): void {
    const existing = this.db
      .prepare(`SELECT translation_group_id FROM posts WHERE slug = ? AND lang = ? LIMIT 1`)
      .get(post.slug, post.lang) as { translation_group_id: string } | undefined;

    this.db
      .prepare(
        `INSERT INTO posts
           (slug, lang, translation_group_id, translation_key, title, description, body_md, body_html,
            author, hero_image, hero_alt, tags, draft, pub_date, updated_date,
            meta_title, meta_description, focus_keyword, secondary_keywords,
            open_graph_image, open_graph_title, open_graph_description, toc_json, json_ld)
         VALUES
           (@slug, @lang, @translationGroupId, @translationKey, @title, @description, @bodyMd, @bodyHtml,
            @author, @heroImage, @heroAlt, @tags, @draft, @pubDate, @updatedDate,
            @metaTitle, @metaDescription, @focusKeyword, @secondaryKeywords,
            @openGraphImage, @openGraphTitle, @openGraphDescription, @tocJson, @jsonLd)
         ON CONFLICT (slug, lang) DO UPDATE SET
           translation_group_id = excluded.translation_group_id,
           translation_key = excluded.translation_key,
           title = excluded.title,
           description = excluded.description,
           body_md = excluded.body_md,
           body_html = excluded.body_html,
           author = excluded.author,
           hero_image = excluded.hero_image,
           hero_alt = excluded.hero_alt,
           tags = excluded.tags,
           draft = excluded.draft,
           pub_date = excluded.pub_date,
           updated_date = excluded.updated_date,
           meta_title = excluded.meta_title,
           meta_description = excluded.meta_description,
           focus_keyword = excluded.focus_keyword,
           secondary_keywords = excluded.secondary_keywords,
           open_graph_image = excluded.open_graph_image,
           open_graph_title = excluded.open_graph_title,
           open_graph_description = excluded.open_graph_description,
           toc_json = excluded.toc_json,
           json_ld = excluded.json_ld`,
      )
      .run(toParams(post));

    this.syncTranslationGroup(post.translationGroupId, post.draft);
    if (existing && existing.translation_group_id !== post.translationGroupId) {
      this.refreshTranslationGroup(existing.translation_group_id);
    }
  }

  // ---- Admin (all languages, includes drafts) ----

  /** All posts (any language, including drafts), newest first. */
  listAll(): AdminPost[] {
    const rows = this.db
      .prepare(
        `SELECT ${selectColumns()} FROM posts p
         LEFT JOIN translation_groups g ON g.id = p.translation_group_id
         ORDER BY p.pub_date DESC, p.id DESC`,
      )
      .all() as PostRow[];
    return rows.map(toAdmin);
  }

  /** A single post by id (including draft + raw Markdown). */
  getById(id: number): AdminPost | null {
    const row = this.db
      .prepare(
        `SELECT ${selectColumns()} FROM posts p
         LEFT JOIN translation_groups g ON g.id = p.translation_group_id
         WHERE p.id = ?
         LIMIT 1`,
      )
      .get(id) as PostRow | undefined;
    return row ? toAdmin(row) : null;
  }

  /** Creates a new post, rendering its Markdown. Returns the new id. */
  create(post: Post): number {
    const result = this.db
      .prepare(
        `INSERT INTO posts
           (slug, lang, translation_group_id, translation_key, title, description, body_md, body_html,
            author, hero_image, hero_alt, tags, draft, pub_date, updated_date,
            meta_title, meta_description, focus_keyword, secondary_keywords,
            open_graph_image, open_graph_title, open_graph_description, toc_json, json_ld)
         VALUES
           (@slug, @lang, @translationGroupId, @translationKey, @title, @description, @bodyMd, @bodyHtml,
            @author, @heroImage, @heroAlt, @tags, @draft, @pubDate, @updatedDate,
            @metaTitle, @metaDescription, @focusKeyword, @secondaryKeywords,
            @openGraphImage, @openGraphTitle, @openGraphDescription, @tocJson, @jsonLd)`,
      )
      .run(toParams(post));

    this.syncTranslationGroup(post.translationGroupId, post.draft);
    return Number(result.lastInsertRowid);
  }

  /** Updates an existing post by id. Returns false if no row matched. */
  updateById(id: number, post: Post): boolean {
    const existing = this.getById(id);
    if (!existing) return false;

    const result = this.db
      .prepare(
        `UPDATE posts SET
           slug = @slug, lang = @lang, translation_group_id = @translationGroupId,
           translation_key = @translationKey,
           title = @title, description = @description, body_md = @bodyMd,
           body_html = @bodyHtml, author = @author, hero_image = @heroImage,
           hero_alt = @heroAlt, tags = @tags, draft = @draft,
           pub_date = @pubDate, updated_date = @updatedDate,
           meta_title = @metaTitle, meta_description = @metaDescription,
           focus_keyword = @focusKeyword, secondary_keywords = @secondaryKeywords,
           open_graph_image = @openGraphImage, open_graph_title = @openGraphTitle,
           open_graph_description = @openGraphDescription, toc_json = @tocJson,
           json_ld = @jsonLd
         WHERE id = @id`,
      )
      .run({ ...toParams(post), id });

    this.syncTranslationGroup(post.translationGroupId, post.draft);
    if (existing.translationGroupId !== post.translationGroupId) {
      this.refreshTranslationGroup(existing.translationGroupId);
    }

    return result.changes > 0;
  }

  /** Deletes a post by id. Returns false if no row matched. */
  removeById(id: number): boolean {
    const existing = this.getById(id);
    if (!existing) return false;

    const result = this.db.prepare(`DELETE FROM posts WHERE id = ?`).run(id);
    this.refreshTranslationGroup(existing.translationGroupId);
    return result.changes > 0;
  }

  private syncTranslationGroup(groupId: string, draft: boolean): void {
    this.db
      .prepare(
        `INSERT INTO translation_groups (id, published)
         VALUES (?, ?)
         ON CONFLICT(id) DO UPDATE SET published = excluded.published`,
      )
      .run(groupId, draft ? 0 : 1);

    this.db
      .prepare(`UPDATE posts SET draft = ? WHERE translation_group_id = ?`)
      .run(draft ? 1 : 0, groupId);
  }

  private refreshTranslationGroup(groupId: string): void {
    const rows = this.db
      .prepare(`SELECT draft FROM posts WHERE translation_group_id = ?`)
      .all(groupId) as { draft: number }[];

    if (rows.length === 0) {
      this.db.prepare(`DELETE FROM translation_groups WHERE id = ?`).run(groupId);
      return;
    }

    const published = rows.every((row) => row.draft === 0) ? 1 : 0;

    this.db
      .prepare(
        `INSERT INTO translation_groups (id, published)
         VALUES (?, ?)
         ON CONFLICT(id) DO UPDATE SET published = excluded.published`,
      )
      .run(groupId, published);

    this.db
      .prepare(`UPDATE posts SET draft = ? WHERE translation_group_id = ?`)
      .run(published ? 0 : 1, groupId);
  }

  /** Total row count — used to decide whether to seed an empty database. */
  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM posts').get() as {
      n: number;
    };
    return row.n;
  }
}
