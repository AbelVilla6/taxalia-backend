import { z } from 'zod';

/** Supported content languages. Kept in sync with the frontend i18n langs. */
export const LANGS = ['en', 'es'] as const;
export type Lang = (typeof LANGS)[number];

export const LangSchema = z.enum(LANGS);

export const TocDepthSchema = z.union([z.literal(2), z.literal(3), z.literal(4)]);

export const TocEntrySchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  depth: TocDepthSchema,
});

export type TocEntry = z.infer<typeof TocEntrySchema>;

export interface AlternateLink {
  slug: string;
  url: string;
}

export interface SeoData {
  metaTitle: string;
  metaDescription: string;
  canonicalUrl: string;
  focusKeyword: string | null;
  secondaryKeywords: string[];
  openGraphImage: string | null;
  openGraphTitle: string;
  openGraphDescription: string;
}

export interface ArticleJsonLd {
  '@context': 'https://schema.org';
  '@type': 'Article';
  headline: string;
  description: string;
  author: { '@type': 'Organization'; name: string };
  datePublished: string;
  dateModified: string;
  image?: string[];
  keywords: string[];
  inLanguage: Lang;
  mainEntityOfPage: string;
  url: string;
}

/**
 * A blog post as stored in the content database. Each row is one post in one
 * language; the two language versions of the same article share a
 * `translationGroupId` so the frontend can link them and emit hreflang alternates.
 */
export const PostSchema = z.object({
  slug: z.string().min(1),
  lang: LangSchema,
  translationGroupId: z.string().min(1),
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
  metaTitle: z.string().optional().nullable(),
  metaDescription: z.string().optional().nullable(),
  focusKeyword: z.string().optional().nullable(),
  secondaryKeywords: z.array(z.string()).optional(),
  openGraphImage: z.string().optional().nullable(),
  openGraphTitle: z.string().optional().nullable(),
  openGraphDescription: z.string().optional().nullable(),
  jsonLd: z
    .string()
    .optional()
    .nullable()
    .refine(
      (value) => {
        if (value == null || value === '') return true;
        try {
          const parsed = JSON.parse(value) as unknown;
          return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
        } catch {
          return false;
        }
      },
      { message: 'jsonLd must be a JSON object' },
    ),
});

export type Post = z.infer<typeof PostSchema>;

/** Shape returned by the list endpoint (no body, lighter payload). */
export interface PostSummary {
  slug: string;
  lang: Lang;
  translationGroupId: string;
  published: boolean;
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
  alternates: Partial<Record<Lang, AlternateLink>>;
  seo: SeoData;
  toc: TocEntry[];
  articleJsonLd: ArticleJsonLd;
  /** Hand-curated JSON-LD (e.g. FAQPage) stored with the post, if any. */
  customJsonLd: Record<string, unknown> | null;
  contentHtml: string;
}
