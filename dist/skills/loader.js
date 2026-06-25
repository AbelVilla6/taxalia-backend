import { z } from 'zod';
import { loadMarkdownArtifacts } from '../loaders/frontmatter.js';
export const SkillDefSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1),
    tags: z.array(z.string()).default([]),
});
export function loadSkills(dir) {
    return loadMarkdownArtifacts(dir, SkillDefSchema);
}
