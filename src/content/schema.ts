import { z } from 'zod';

/** Supported content languages. Kept in sync with the frontend i18n langs. */
export const LANGS = ['en', 'es'] as const;
export type Lang = (typeof LANGS)[number];

export const LangSchema = z.enum(LANGS);

/**
 * A blog post as stored in the content database. Each row is one post in one
 * language; the two language versions of the same article share a
 * `translationKey` so the frontend can link them and emit hreflang alternates.
 */
export const PostSchema = z.object({
  slug: z.string().min(1),
  lang: LangSchema,
  translationKey: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(''),
  bodyMd: z.string().default(''),
  author: z.string().default('Taxalia'),
  heroImage: z.string().optional().nullable(),
  heroAlt: z.string().optional().nullable(),
  tags: z.array(z.string()).default([]),
  draft: z.boolean().default(false),
  pubDate: z.string(),
  updatedDate: z.string().optional().nullable(),
});

export type Post = z.infer<typeof PostSchema>;

/** Shape returned by the list endpoint (no body, lighter payload). */
export interface PostSummary {
  slug: string;
  lang: Lang;
  translationKey: string;
  title: string;
  description: string;
  author: string;
  heroImage: string | null;
  heroAlt: string | null;
  tags: string[];
  pubDate: string;
  updatedDate: string | null;
}

/** Shape returned by the detail endpoint (includes rendered HTML). */
export interface PostDetail extends PostSummary {
  contentHtml: string;
}
