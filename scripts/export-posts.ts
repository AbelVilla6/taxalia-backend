/**
 * Usage: tsx scripts/export-posts.ts [output.json]
 *
 * Exports all posts from the blog DB to a JSON file.
 * DB path: BLOG_DB_PATH env var or ./data/blog.db
 * Output:  first CLI arg or ./data/posts-export.json
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openBlogDb } from '../src/content/db.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = process.env.BLOG_DB_PATH ?? resolve(root, 'data/blog.db');
const outPath = process.argv[2] ? resolve(process.argv[2]) : resolve(root, 'data/posts-export.json');

const db = openBlogDb(dbPath);

const posts = db
  .prepare(
    `SELECT
       slug, lang, translation_group_id AS translationGroupId, title, description,
       body_md AS bodyMd, author, hero_image AS heroImage, hero_alt AS heroAlt,
       tags, draft, pub_date AS pubDate, updated_date AS updatedDate,
       meta_title AS metaTitle, meta_description AS metaDescription,
       focus_keyword AS focusKeyword, secondary_keywords AS secondaryKeywords,
       open_graph_image AS openGraphImage, open_graph_title AS openGraphTitle,
       open_graph_description AS openGraphDescription, json_ld AS jsonLd
     FROM posts
     ORDER BY pub_date DESC, id DESC`,
  )
  .all()
  .map((row) => {
    const r = row as Record<string, unknown>;
    return {
      ...r,
      tags: JSON.parse(r.tags as string) as string[],
      secondaryKeywords: JSON.parse(r.secondaryKeywords as string) as string[],
      draft: r.draft === 1,
    };
  });

writeFileSync(outPath, JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), posts }, null, 2));
console.log(`Exported ${posts.length} post(s) → ${outPath}`);
