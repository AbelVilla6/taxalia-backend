import { z } from 'zod';
export const OrchestratorDecisionSchema = z.object({
    agentsToRun: z.array(z.string()),
    reasoning: z.string(),
});
export const EMPTY_DECISION = {
    agentsToRun: [],
    reasoning: '',
};
