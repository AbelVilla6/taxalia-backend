import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { readRuntimeTextAsset, resolveExistingPath } from '../../src/admin/runtimePaths.js';

describe('admin runtime paths', () => {
  let root = '';

  afterEach(() => {
    if (root) {
      rmSync(root, { recursive: true, force: true });
      root = '';
    }
  });

  it('resolves production copies before source fallbacks', () => {
    root = mkdtempSync(join(tmpdir(), 'taxalia-runtime-'));

    mkdirSync(join(root, 'dist/admin/public'), { recursive: true });
    mkdirSync(join(root, 'src/admin/public'), { recursive: true });
    mkdirSync(join(root, 'dist/editorial'), { recursive: true });
    mkdirSync(join(root, 'src/editorial'), { recursive: true });

    writeFileSync(join(root, 'dist/admin/public/index.html'), 'dist index');
    writeFileSync(join(root, 'src/admin/public/index.html'), 'src index');
    writeFileSync(join(root, 'dist/editorial/translate-post.md'), 'dist prompt');
    writeFileSync(join(root, 'src/editorial/translate-post.md'), 'src prompt');

    const serverModuleUrl = pathToFileURL(join(root, 'dist/server.js')).href;
    const routesModuleUrl = pathToFileURL(join(root, 'dist/admin/routes.js')).href;

    expect(
      resolveExistingPath(serverModuleUrl, ['admin/public', '../src/admin/public']),
    ).toBe(join(root, 'dist/admin/public'));
    expect(
      readRuntimeTextAsset(routesModuleUrl, ['../editorial/translate-post.md', '../../src/editorial/translate-post.md']),
    ).toBe('dist prompt');

    rmSync(join(root, 'dist/admin/public'), { recursive: true, force: true });
    rmSync(join(root, 'dist/editorial/translate-post.md'), { force: true });

    expect(
      resolveExistingPath(serverModuleUrl, ['admin/public', '../src/admin/public']),
    ).toBe(join(root, 'src/admin/public'));
    expect(
      readRuntimeTextAsset(routesModuleUrl, ['../editorial/translate-post.md', '../../src/editorial/translate-post.md']),
    ).toBe('src prompt');
  });
});
