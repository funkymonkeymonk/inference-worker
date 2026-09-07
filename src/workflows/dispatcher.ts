import {
  continueAsNew,
  defineQuery,
  executeChild,
  proxyActivities,
  setHandler,
  sleep,
  workflowInfo,
} from "@temporalio/workflow";
import { DEFAULT_WORK_ITEM_CLEANUP_GRACE_SECONDS } from "../types.js";
import type { DispatchCandidate, DispatcherInput, DispatcherState, WorkItemInput } from "../types.js";
import { WorkItemWorkflow } from "./work-item.js";

interface DispatcherActivities {
  listDispatchCandidates(input: { excludeIds: string[]; limit: number }): Promise<DispatchCandidate[]>;
  claimTask(id: string): Promise<void>;
  recordTaskFailure(id: string, reason: string): Promise<void>;
  markTaskDone(id: string): Promise<void>;
}

const { listDispatchCandidates, claimTask, recordTaskFailure, markTaskDone } = proxyActivities<DispatcherActivities>({
  startToCloseTimeout: "5 minutes",
  retry: { maximumAttempts: 1 },
});

export const dispatcherStateQuery = defineQuery<DispatcherState>("state");

export function dispatchExclusions(state: DispatcherState): string[] {
  return [...state.activeTaskIds];
}

export function workItemExecutionTimeout(input: Pick<WorkItemInput, "policy">): number {
  return (input.policy.maxRunTimeSeconds + (input.policy.cleanupGraceSeconds ?? DEFAULT_WORK_ITEM_CLEANUP_GRACE_SECONDS)) * 1000;
}

export function compactDispatcherState(state: DispatcherState): DispatcherState {
  return { activeTaskIds: [...state.activeTaskIds], completedTaskIds: [], failedTaskIds: [] };
}

function failureReason(error: unknown): string {
  if (error && typeof error === "object" && "cause" in error && (error as { cause?: unknown }).cause) {
    return failureReason((error as { cause: unknown }).cause);
  }
  return error instanceof Error ? error.message : String(error);
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
            workflowExecutionTimeout: workItemExecutionTimeout(candidate.workflowInput),
            retry: { maximumAttempts: 1 },
          });
          await markTaskDone(candidate.id);
          state.completedTaskIds.push(candidate.id);
        } catch (error) {
          state.failedTaskIds.push(candidate.id);
          await recordTaskFailure(candidate.id, failureReason(error));
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
