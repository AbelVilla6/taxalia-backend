import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { loadConfig } from '../src/config.js';
import { closeBlogDb, mysqlConfigFromEnv, openBlogDb } from '../src/content/db.js';
import { PostRepository } from '../src/content/repository.js';
import { mapSqlitePostRow } from '../src/content/sqliteMigration.js';

interface MigrationStats {
  read: number;
  migrated: number;
  skipped: number;
  errors: number;
}

interface SqliteStatement {
  iterate(): IterableIterator<Record<string, unknown>>;
}

interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  close(): void;
}

interface MigrationDependencies {
  loadConfig?: typeof loadConfig;
  openBlogDb?: typeof openBlogDb;
  closeBlogDb?: typeof closeBlogDb;
  openSqliteDb?: (sqlitePath: string) => SqliteDatabase;
}

function parseArgs(argv: string[]): { sqlitePath: string; dryRun: boolean } {
  let dryRun = false;
  const positional: string[] = [];

  for (const arg of argv) {
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown argument: ${arg}`);
    }

    positional.push(arg);
  }

  const sqlitePath = positional[0];
  if (!sqlitePath) {
    throw new Error('Usage: blog:migrate:sqlite <sqlite-db-path> [--dry-run]');
  }

  return { sqlitePath, dryRun };
}

function openSqliteDb(sqlitePath: string): SqliteDatabase {
  return new Database(sqlitePath, { readonly: true, fileMustExist: true });
}

async function migrateRows(sqliteDb: SqliteDatabase, repo?: PostRepository): Promise<MigrationStats> {
  const stats: MigrationStats = { read: 0, migrated: 0, skipped: 0, errors: 0 };
  const rows = sqliteDb.prepare('SELECT * FROM posts').iterate();

  for (const row of rows as Iterable<Record<string, unknown>>) {
    stats.read += 1;

    try {
      const post = mapSqlitePostRow(row);
      if (!post) {
        stats.skipped += 1;
        continue;
      }

      stats.migrated += 1;
      if (repo) {
        await repo.upsert(post);
      }
    } catch {
      stats.errors += 1;
    }
  }

  return stats;
}

export async function runSqliteBlogMigration(
  { sqlitePath, dryRun }: { sqlitePath: string; dryRun: boolean },
  dependencies: MigrationDependencies = {},
): Promise<MigrationStats> {
  const resolvedPath = resolve(process.cwd(), sqlitePath);

  if (!existsSync(resolvedPath)) {
    throw new Error(`SQLite file not found: ${resolvedPath}`);
  }

  const sqliteDb = dependencies.openSqliteDb?.(resolvedPath) ?? openSqliteDb(resolvedPath);

  try {
    if (dryRun) {
      return await migrateRows(sqliteDb);
    }

    const loadConfigFn = dependencies.loadConfig ?? loadConfig;
    const openBlogDbFn = dependencies.openBlogDb ?? openBlogDb;
    const closeBlogDbFn = dependencies.closeBlogDb ?? closeBlogDb;
    const config = loadConfigFn({ ...process.env });
    const mysqlDb = await openBlogDbFn(mysqlConfigFromEnv(config));

    try {
      const repo = new PostRepository(mysqlDb, config.FRONTEND_SITE_URL);
      return await migrateRows(sqliteDb, repo);
    } finally {
      await closeBlogDbFn(mysqlDb);
    }
  } finally {
    sqliteDb.close();
  }
}

async function main(): Promise<void> {
  const { sqlitePath, dryRun } = parseArgs(process.argv.slice(2));
  const stats = await runSqliteBlogMigration({ sqlitePath, dryRun });
  const resolvedPath = resolve(process.cwd(), sqlitePath);

  console.log(
    `source=${resolvedPath} dry-run=${dryRun ? 'yes' : 'no'} rows-read=${stats.read} rows-migrated=${stats.migrated} rows-skipped=${stats.skipped} errors=${stats.errors}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
