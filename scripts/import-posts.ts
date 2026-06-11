/**
 * Usage: tsx scripts/import-posts.ts [input.json] [--dry-run]
 *
 * Imports posts from a JSON file exported by export-posts.ts.
 * Uses upsert (slug + lang), so running it twice is safe.
 * DB path: BLOG_DB_PATH env var or ./data/blog.db
 * Input:   first CLI arg or ./data/posts-export.json
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openBlogDb } from '../src/content/db.js';
import { PostRepository } from '../src/content/repository.js';
import { PostSchema } from '../src/content/schema.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const inputArg = args.find((a) => !a.startsWith('--'));

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = process.env.BLOG_DB_PATH ?? resolve(root, 'data/blog.db');
const inPath = inputArg ? resolve(inputArg) : resolve(root, 'data/posts-export.json');

const raw = JSON.parse(readFileSync(inPath, 'utf8')) as { version: number; posts: unknown[] };

if (raw.version !== 1) {
  console.error(`Unsupported export version: ${raw.version}`);
  process.exit(1);
}

const db = openBlogDb(dbPath);
const repo = new PostRepository(db);

let ok = 0;
let failed = 0;

for (const entry of raw.posts) {
  const parsed = PostSchema.safeParse(entry);
  if (!parsed.success) {
    console.error(`SKIP invalid post:`, JSON.stringify(entry).slice(0, 120));
    console.error('  ', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', '));
    failed++;
    continue;
  }
  if (!dryRun) {
    repo.upsert(parsed.data);
  }
  console.log(`${dryRun ? '[dry]' : ''}  upserted: [${parsed.data.lang}] ${parsed.data.slug}`);
  ok++;
}

console.log(`\nDone — ${ok} upserted, ${failed} skipped${dryRun ? ' (dry run, no writes)' : ''}.`);
if (failed > 0) process.exit(1);
