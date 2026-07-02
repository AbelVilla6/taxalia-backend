import { cpSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function copyAsset(source, destination) {
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination, { recursive: true, force: true });
}

copyAsset(resolve(root, 'src/editorial/translate-post.md'), resolve(root, 'dist/editorial/translate-post.md'));
copyAsset(resolve(root, 'src/admin/public'), resolve(root, 'dist/admin/public'));
