import { defineQuery, executeChild, proxyActivities, setHandler, sleep } from "@temporalio/workflow";
import type { DispatchCandidate, DispatcherInput, DispatcherState } from "../types.js";
import { WorkItemWorkflow } from "./work-item.js";

interface DispatcherActivities {
  listDispatchCandidates(input: { excludeIds: string[]; limit: number }): Promise<DispatchCandidate[]>;
  claimTask(id: string): Promise<void>;
  releaseTask(id: string, reason: string): Promise<void>;
  markTaskDone(id: string): Promise<void>;
}

const { listDispatchCandidates, claimTask, releaseTask, markTaskDone } = proxyActivities<DispatcherActivities>({
  startToCloseTimeout: "5 minutes",
  retry: { maximumAttempts: 1 },
});

export const dispatcherStateQuery = defineQuery<DispatcherState>("state");

export async function WorkDispatcherWorkflow(input: DispatcherInput): Promise<DispatcherState> {
  const state: DispatcherState = { activeTaskIds: [], completedTaskIds: [], failedTaskIds: [] };
  setHandler(dispatcherStateQuery, () => state);
  const capacity = Math.max(0, input.maxConcurrentImplementations);
  do {
    const candidates = capacity === 0 ? [] : await listDispatchCandidates({ excludeIds: state.activeTaskIds, limit: capacity });
    for (const candidate of candidates.slice(0, capacity - state.activeTaskIds.length)) {
      await claimTask(candidate.id);
      state.activeTaskIds.push(candidate.id);
      try {
        await executeChild(WorkItemWorkflow, {
          args: [candidate.workflowInput],
          workflowId: `work-item-${candidate.id}`,
        });
        await markTaskDone(candidate.id);
        state.completedTaskIds.push(candidate.id);
      } catch (error) {
        state.failedTaskIds.push(candidate.id);
        await releaseTask(candidate.id, error instanceof Error ? error.message : String(error));
      } finally {
        state.activeTaskIds.splice(state.activeTaskIds.indexOf(candidate.id), 1);
      }
    }
    if (input.runOnce) return state;
    await sleep(input.pollIntervalMs ?? 60_000);
  } while (true);
}
