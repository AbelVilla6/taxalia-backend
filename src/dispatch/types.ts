import { z } from 'zod';
import type { Lang, AgentResult } from '../chat/schemas.js';

export type { Lang, AgentResult };

export const OrchestratorDecisionSchema = z.object({
  agentsToRun: z.array(z.string()),
  reasoning: z.string(),
});

export type OrchestratorDecision = z.infer<typeof OrchestratorDecisionSchema>;

export type DispatchResult = AgentResult[];

export const EMPTY_DECISION: OrchestratorDecision = {
  agentsToRun: [],
  reasoning: '',
};
