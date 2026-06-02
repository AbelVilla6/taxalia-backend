import { z } from 'zod';
import { loadMarkdownArtifacts, type LoadedArtifact } from '../loaders/frontmatter.js';

export const SkillDefSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  tags: z.array(z.string()).default([]),
});

export type SkillDef = LoadedArtifact<z.infer<typeof SkillDefSchema>>;

export function loadSkills(dir: string): Promise<SkillDef[]> {
  return loadMarkdownArtifacts(dir, SkillDefSchema);
}
