import { z } from 'zod';
/** Supported content languages. Kept in sync with the frontend i18n langs. */
export const LANGS = ['en', 'es'];
export const LangSchema = z.enum(LANGS);
export const TocDepthSchema = z.union([z.literal(2), z.literal(3), z.literal(4)]);
export const TocEntrySchema = z.object({
    id: z.string().min(1),
    text: z.string().min(1),
    depth: TocDepthSchema,
});
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
        .refine((value) => {
        if (value == null || value === '')
            return true;
        try {
            const parsed = JSON.parse(value);
            return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
        }
        catch {
            return false;
        }
    }, { message: 'jsonLd must be a JSON object' }),
});
