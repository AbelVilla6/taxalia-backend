import { z } from 'zod';
import { loadMarkdownArtifacts, LoaderError, type LoadedArtifact } from '../loaders/frontmatter.js';

export const EXPECTED_CONDUCT_POLICY_COUNT = 5;

export const ConductDefSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  rule: z.string().min(1),
  priority: z.number().int(),
});

export type ConductDef = LoadedArtifact<z.infer<typeof ConductDefSchema>>;

export async function loadConducta(dir: string): Promise<ConductDef[]> {
  const artifacts = await loadMarkdownArtifacts(dir, ConductDefSchema);
  if (artifacts.length !== EXPECTED_CONDUCT_POLICY_COUNT) {
    throw new LoaderError(
      `Expected ${EXPECTED_CONDUCT_POLICY_COUNT} conduct policies, found ${artifacts.length}. Add files to backend/src/conducta/.`,
    );
  }
  return artifacts;
}
