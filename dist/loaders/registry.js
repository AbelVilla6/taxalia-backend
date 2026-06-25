import { join } from 'node:path';
import { loadAgents } from '../agents/loader.js';
import { loadConducta } from '../conducta/loader.js';
import { loadSkills } from '../skills/loader.js';
export function defaultArtifactDirs(root = process.cwd()) {
    return {
        agents: join(root, 'src/agents'),
        skills: join(root, 'src/skills'),
        conducta: join(root, 'src/conducta'),
    };
}
export function createArtifactRegistry(dirs = defaultArtifactDirs(), initial = { agents: [], skills: [], conducta: [] }) {
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
