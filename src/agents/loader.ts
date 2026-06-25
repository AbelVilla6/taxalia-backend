import { z } from 'zod';
import { loadMarkdownArtifacts, type LoadedArtifact } from '../loaders/frontmatter.js';

export const AgentDefSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  system_prompt: z.string().min(1),
  tools: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
});

export type AgentDef = LoadedArtifact<z.infer<typeof AgentDefSchema>> & {
  systemPrompt: string;
};

const SERVICE_AGENT_IDS = new Set(['income-tax', 'business-accounting', 'irs-tax-resolution']);

export async function loadAgents(dir: string): Promise<AgentDef[]> {
  const artifacts = await loadMarkdownArtifacts(dir, AgentDefSchema);
  return artifacts
    .filter((artifact) => SERVICE_AGENT_IDS.has(artifact.id))
    .map((artifact) => ({
      ...artifact,
      systemPrompt: artifact.system_prompt,
    }));
}
