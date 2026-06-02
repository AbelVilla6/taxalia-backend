import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildChatRouter } from '../../src/chat/routes.js';
import { createArtifactRegistry } from '../../src/loaders/registry.js';
import { requestIdMiddleware } from '../../src/observability/requestId.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'taxalia-reload-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function write(dir: string, name: string, frontmatter: string): Promise<void> {
  const full = join(root, dir);
  await mkdir(full, { recursive: true });
  await writeFile(join(full, name), `---\n${frontmatter}\n---\n# Body\n`, 'utf8');
}

async function seedValidArtifacts(): Promise<void> {
  for (const id of ['advisory', 'valuation', 'financial']) {
    await write('agents', `${id}.md`, `id: ${id}\nname: ${id}\ndescription: ${id}\nsystem_prompt: |\n  Prompt ${id}`);
  }
  for (const id of ['lookup-engagement-model', 'calculate-valuation', 'capture-lead']) {
    await write('skills', `${id}.md`, `id: ${id}\nname: ${id}\ndescription: ${id}`);
  }
  for (let i = 1; i <= 5; i++) {
    await write('conducta', `policy-${i}.md`, `id: policy-${i}\ndescription: Policy ${i}\nrule: Rule ${i}\npriority: ${i}`);
  }
}

describe('POST /admin/reload', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('keeps the previous registry when reload fails', async () => {
    await seedValidArtifacts();
    const registry = createArtifactRegistry({
      agents: join(root, 'agents'),
      skills: join(root, 'skills'),
      conducta: join(root, 'conducta'),
    });
    await registry.reload();
    const before = registry.snapshot();

    await write('skills', 'broken.md', 'id: broken\nname: Broken');

    const app = new Hono();
    app.use('*', requestIdMiddleware);
    app.route('/', buildChatRouter(registry));

    const res = await app.request('/admin/reload', { method: 'POST' });
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: { code: 'RELOAD_FAILED' } });
    expect(registry.snapshot()).toEqual(before);
  });

  it('is not available in production', async () => {
    process.env.NODE_ENV = 'production';
    const app = new Hono();
    app.use('*', requestIdMiddleware);
    app.route('/', buildChatRouter(createArtifactRegistry()));

    const res = await app.request('/admin/reload', { method: 'POST' });
    expect(res.status).toBe(404);
  });
});
