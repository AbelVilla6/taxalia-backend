import { PostSchema, type Post } from './schema.js';

export type SqlitePostRow = Record<string, unknown>;

const DEFAULT_AUTHOR = 'Taxalia';

function readField(row: SqlitePostRow, keys: string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      return row[key];
    }
  }

  return undefined;
}

function toStringValue(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return String(value);
  }

  return undefined;
}

function toRequiredString(value: unknown): string | undefined {
  const text = toStringValue(value)?.trim();
  return text && text.length > 0 ? text : undefined;
}

function toNullableString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return String(value);
  }

  return JSON.stringify(value);
}

function parseJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (typeof item !== 'string') return [];
      const trimmed = item.trim();
      return trimmed.length > 0 ? [trimmed] : [];
    });
  }

  if (typeof value !== 'string' || value.trim() === '') return [];

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed.flatMap((item) => {
      if (typeof item !== 'string') return [];
      const trimmed = item.trim();
      return trimmed.length > 0 ? [trimmed] : [];
    });
  } catch {
    return [];
  }
}

function toBoolean(value: unknown, fallback = false): boolean {
  if (value == null) return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'bigint') return value !== 0n;
  if (typeof value !== 'string') return fallback;

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off', ''].includes(normalized)) return false;

  return fallback;
}

function readJsonLd(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function readArrayField(row: SqlitePostRow, keys: string[]): string[] {
  return parseJsonArray(readField(row, keys));
}

function readStringField(row: SqlitePostRow, keys: string[], fallback = ''): string {
  return toStringValue(readField(row, keys)) ?? fallback;
}

function readOptionalStringField(row: SqlitePostRow, keys: string[]): string | null {
  return toNullableString(readField(row, keys));
}

function readRequiredStringField(row: SqlitePostRow, keys: string[]): string | null {
  return toRequiredString(readField(row, keys)) ?? null;
}

function readTranslationGroupId(row: SqlitePostRow, slug: string): string {
  return (
    toRequiredString(readField(row, ['translation_group_id', 'translationGroupId', 'translation_key', 'translationKey'])) ??
    slug
  );
}

function readBodyMd(row: SqlitePostRow): string {
  return readStringField(row, ['body_md', 'bodyMd', 'content_md', 'contentMd', 'markdown', 'content', 'body']);
}

function readDraft(row: SqlitePostRow): boolean {
  const explicitDraft = readField(row, ['draft', 'is_draft', 'isDraft']);
  if (explicitDraft != null) return toBoolean(explicitDraft);

  const published = readField(row, ['published', 'is_published', 'isPublished']);
  if (published != null) return !toBoolean(published);

  return false;
}

export function mapSqlitePostRow(row: SqlitePostRow): Post | null {
  const slug = readRequiredStringField(row, ['slug']);
  const lang = readRequiredStringField(row, ['lang']);
  const title = readRequiredStringField(row, ['title']);
  const pubDate = readRequiredStringField(row, ['pub_date', 'pubDate', 'published_at', 'publishedAt', 'date_published', 'datePublished']);

  if (!slug || !lang || !title || !pubDate) return null;

  const candidate = {
    slug,
    lang,
    translationGroupId: readTranslationGroupId(row, slug),
    title,
    description: readStringField(row, ['description', 'excerpt', 'summary']),
    bodyMd: readBodyMd(row),
    author: readStringField(row, ['author'], DEFAULT_AUTHOR),
    heroImage: readOptionalStringField(row, ['hero_image', 'heroImage']),
    heroAlt: readOptionalStringField(row, ['hero_alt', 'heroAlt']),
    tags: readArrayField(row, ['tags']),
    draft: readDraft(row),
    pubDate,
    updatedDate: readOptionalStringField(row, ['updated_date', 'updatedDate', 'modified_at', 'modifiedAt']),
    metaTitle: readOptionalStringField(row, ['meta_title', 'metaTitle']),
    metaDescription: readOptionalStringField(row, ['meta_description', 'metaDescription']),
    focusKeyword: readOptionalStringField(row, ['focus_keyword', 'focusKeyword']),
    secondaryKeywords: readArrayField(row, ['secondary_keywords', 'secondaryKeywords']),
    openGraphImage: readOptionalStringField(row, ['open_graph_image', 'openGraphImage']),
    openGraphTitle: readOptionalStringField(row, ['open_graph_title', 'openGraphTitle']),
    openGraphDescription: readOptionalStringField(row, ['open_graph_description', 'openGraphDescription']),
    jsonLd: readJsonLd(readField(row, ['json_ld', 'jsonLd'])),
  };

  const parsed = PostSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
