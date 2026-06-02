import { join } from 'node:path';
import { loadAgents, type AgentDef } from '../agents/loader.js';
import { loadConducta, type ConductDef } from '../conducta/loader.js';
import { loadSkills, type SkillDef } from '../skills/loader.js';

export type ArtifactRegistrySnapshot = {
  agents: AgentDef[];
  skills: SkillDef[];
  conducta: ConductDef[];
};

export type ArtifactRegistryDirs = {
  agents: string;
  skills: string;
  conducta: string;
};

export type ArtifactRegistry = {
  snapshot(): ArtifactRegistrySnapshot;
  reload(): Promise<ArtifactRegistrySnapshot>;
};

export function defaultArtifactDirs(root = process.cwd()): ArtifactRegistryDirs {
  return {
    agents: join(root, 'src/agents'),
    skills: join(root, 'src/skills'),
    conducta: join(root, 'src/conducta'),
  };
}

export function createArtifactRegistry(
  dirs: ArtifactRegistryDirs = defaultArtifactDirs(),
  initial: ArtifactRegistrySnapshot = { agents: [], skills: [], conducta: [] },
): ArtifactRegistry {
  let current = initial;

  return {
    snapshot: () => current,
    reload: async () => {
      const next = {
        agents: await loadAgents(dirs.agents),
        skills: await loadSkills(dirs.skills),
        conducta: await loadConducta(dirs.conducta),
      };
      current = next;
      return current;
    },
  };
}
