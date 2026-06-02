import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadAgents } from '../../src/agents/loader.js';
import { loadConducta } from '../../src/conducta/loader.js';
import { loadSkills } from '../../src/skills/loader.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'taxalia-loaders-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function write(dir: string, name: string, frontmatter: string): Promise<void> {
  const full = join(root, dir);
  await mkdir(full, { recursive: true });
  await writeFile(join(full, name), `---\n${frontmatter}\n---\n# Body\n`, 'utf8');
}

describe('loaders', () => {
  it('loads valid agent, skill, and conducta frontmatter', async () => {
    await write('agents', 'advisory.md', 'id: advisory\nname: Advisory\ndescription: Helps\nsystem_prompt: |\n  System prompt\ntools: [lookup-engagement-model]\ntags: [advisory]');
    await write('skills', 'lookup-engagement-model.md', 'id: lookup-engagement-model\nname: Lookup\ndescription: Finds engagement model');
    for (let i = 1; i <= 5; i++) {
      await write('conducta', `policy-${i}.md`, `id: policy-${i}\ndescription: Policy ${i}\nrule: |\n  Rule ${i}\npriority: ${i}`);
    }

    const agents = await loadAgents(join(root, 'agents'));
    const skills = await loadSkills(join(root, 'skills'));
    const conducta = await loadConducta(join(root, 'conducta'));

    expect(agents[0]).toMatchObject({ id: 'advisory', systemPrompt: 'System prompt' });
    expect(skills[0]).toMatchObject({ id: 'lookup-engagement-model' });
    expect(conducta).toHaveLength(5);
  });

  it('names the file and missing field when frontmatter is invalid', async () => {
    await write('agents', 'broken.md', 'id: broken\nname: Broken\ndescription: Missing prompt');

    await expect(loadAgents(join(root, 'agents'))).rejects.toThrow(/broken\.md.*system_prompt/);
  });

  it('names both file paths when duplicate ids exist', async () => {
    await write('skills', 'a.md', 'id: duplicate\nname: A\ndescription: First');
    await write('skills', 'b.md', 'id: duplicate\nname: B\ndescription: Second');

    await expect(loadSkills(join(root, 'skills'))).rejects.toThrow(/a\.md.*b\.md/);
  });

  it('fails when conducta count is not exactly five', async () => {
    for (let i = 1; i <= 4; i++) {
      await write('conducta', `policy-${i}.md`, `id: policy-${i}\ndescription: Policy ${i}\nrule: Rule ${i}\npriority: ${i}`);
    }

    await expect(loadConducta(join(root, 'conducta'))).rejects.toThrow(/Expected 5 conduct policies, found 4/);
  });
});
