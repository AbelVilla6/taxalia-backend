import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { runSqliteBlogMigration } from '../../scripts/migrate-sqlite-blog.js';
import { mapSqlitePostRow } from '../../src/content/sqliteMigration.js';

describe('mapSqlitePostRow', () => {
  it('maps legacy SQLite columns into a repository post payload', () => {
    expect(
      mapSqlitePostRow({
        slug: 'old-post',
        lang: 'es',
        translation_key: 'old-group',
        title: '  Migrated post  ',
        description: 'Legacy description',
        body_md: '# Hello world',
        author: 'Editor',
        hero_image: 'https://cdn.example.com/hero.jpg',
        hero_alt: 'Hero alt text',
        tags: '["taxes","blog"]',
        draft: 1,
        pub_date: '2024-01-01',
        updated_date: '2024-01-02',
        meta_title: 'SEO title',
        meta_description: 'SEO description',
        focus_keyword: 'tax filing',
        secondary_keywords: '["accounting","returns"]',
        open_graph_image: 'https://cdn.example.com/og.jpg',
        open_graph_title: 'OG title',
        open_graph_description: 'OG description',
        json_ld: '{"@context":"https://schema.org","@type":"Article"}',
      }),
    ).toEqual({
      slug: 'old-post',
      lang: 'es',
      translationGroupId: 'old-group',
      title: 'Migrated post',
      description: 'Legacy description',
      bodyMd: '# Hello world',
      author: 'Editor',
      heroImage: 'https://cdn.example.com/hero.jpg',
      heroAlt: 'Hero alt text',
      tags: ['taxes', 'blog'],
      draft: true,
      pubDate: '2024-01-01',
      updatedDate: '2024-01-02',
      metaTitle: 'SEO title',
      metaDescription: 'SEO description',
      focusKeyword: 'tax filing',
      secondaryKeywords: ['accounting', 'returns'],
      openGraphImage: 'https://cdn.example.com/og.jpg',
      openGraphTitle: 'OG title',
      openGraphDescription: 'OG description',
      jsonLd: '{"@context":"https://schema.org","@type":"Article"}',
    });
  });

  it('falls back to translation key, slug, and safe defaults', () => {
    expect(
      mapSqlitePostRow({
        slug: 'fallback-post',
        lang: 'en',
        title: 'Fallback post',
        content_md: 'Body from legacy content column',
        published: 1,
        pubDate: '2024-02-01',
        tags: 'not-json',
        secondaryKeywords: null,
      }),
    ).toEqual({
      slug: 'fallback-post',
      lang: 'en',
      translationGroupId: 'fallback-post',
      title: 'Fallback post',
      description: '',
      bodyMd: 'Body from legacy content column',
      author: 'Taxalia',
      heroImage: null,
      heroAlt: null,
      tags: [],
      draft: false,
      pubDate: '2024-02-01',
      updatedDate: null,
      metaTitle: null,
      metaDescription: null,
      focusKeyword: null,
      secondaryKeywords: [],
      openGraphImage: null,
      openGraphTitle: null,
      openGraphDescription: null,
      jsonLd: null,
    });
  });
});

describe('runSqliteBlogMigration', () => {
  it('does not touch MySQL in dry-run mode', async () => {
    const sqlitePath = join(mkdtempSync(join(tmpdir(), 'taxalia-sqlite-migration-')), 'blog.sqlite');
    writeFileSync(sqlitePath, '');

    const sqliteDb = {
      prepare: vi.fn(() => ({
        iterate: function* () {
          yield {
            slug: 'dry-run-post',
            lang: 'en',
            title: 'Dry run post',
            pub_date: '2024-01-01',
            body_md: 'Dry run body',
            published: 1,
          };
        },
      })),
      close: vi.fn(),
    };

    const openSqliteDb = vi.fn(() => sqliteDb);
    const loadConfig = vi.fn(() => {
      throw new Error('loadConfig should not run in dry-run mode');
    });
    const openBlogDb = vi.fn(() => {
      throw new Error('openBlogDb should not run in dry-run mode');
    });
    const closeBlogDb = vi.fn();

    await expect(
      runSqliteBlogMigration(
        { sqlitePath, dryRun: true },
        { openSqliteDb, loadConfig, openBlogDb, closeBlogDb },
      ),
    ).resolves.toEqual({ read: 1, migrated: 1, skipped: 0, errors: 0 });

    expect(openSqliteDb).toHaveBeenCalledOnce();
    expect(sqliteDb.prepare).toHaveBeenCalledWith('SELECT * FROM posts');
    expect(sqliteDb.close).toHaveBeenCalledOnce();
    expect(loadConfig).not.toHaveBeenCalled();
    expect(openBlogDb).not.toHaveBeenCalled();
    expect(closeBlogDb).not.toHaveBeenCalled();
  });
});
