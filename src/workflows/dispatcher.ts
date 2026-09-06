import {
  continueAsNew,
  defineQuery,
  executeChild,
  proxyActivities,
  setHandler,
  sleep,
  workflowInfo,
} from "@temporalio/workflow";
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

export function dispatchExclusions(state: DispatcherState): string[] {
  return [...state.activeTaskIds, ...state.failedTaskIds];
}

export function compactDispatcherState(state: DispatcherState): DispatcherState {
  return { activeTaskIds: [...state.activeTaskIds], completedTaskIds: [], failedTaskIds: [] };
}

export async function WorkDispatcherWorkflow(input: DispatcherInput): Promise<DispatcherState> {
  const state: DispatcherState = input.state ?? { activeTaskIds: [], completedTaskIds: [], failedTaskIds: [] };
  setHandler(dispatcherStateQuery, () => state);
  const capacity = Math.max(0, input.maxConcurrentImplementations);
  do {
    const candidates = capacity === 0 ? [] : await listDispatchCandidates({ excludeIds: dispatchExclusions(state), limit: capacity });
    const admitted = candidates.slice(0, capacity - state.activeTaskIds.length);
    const executions: Promise<void>[] = [];
    for (const candidate of admitted) {
      await claimTask(candidate.id);
      state.activeTaskIds.push(candidate.id);
      executions.push((async () => {
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
      })());
    }
    await Promise.all(executions);
    if (input.runOnce) return state;
    if (workflowInfo().continueAsNewSuggested) {
      await continueAsNew<typeof WorkDispatcherWorkflow>({ ...input, state: compactDispatcherState(state) });
    }
    await sleep(input.pollIntervalMs ?? 60_000);
  } while (true);
}
