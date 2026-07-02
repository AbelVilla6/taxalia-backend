import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function moduleDir(importMetaUrl: string): string {
  return dirname(fileURLToPath(importMetaUrl));
}

export function resolveExistingPath(
  importMetaUrl: string,
  candidates: readonly string[],
): string {
  const baseDir = moduleDir(importMetaUrl);

  for (const candidate of candidates) {
    const absolute = resolve(baseDir, candidate);
    if (existsSync(absolute)) return absolute;
  }

  throw new Error(`Missing runtime asset. Looked for: ${candidates.map((candidate) => resolve(baseDir, candidate)).join(', ')}`);
}

export function readRuntimeTextAsset(
  importMetaUrl: string,
  candidates: readonly string[],
): string {
  return readFileSync(resolveExistingPath(importMetaUrl, candidates), 'utf8');
}
