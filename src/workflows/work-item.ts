import { proxyActivities, defineQuery, setHandler } from "@temporalio/workflow";
import type { ExecuteAgentInput, ExecuteAgentResult, WorkItemInput, WorkItemState } from "../types.js";

interface WorkItemActivities {
  executeAgent(input: ExecuteAgentInput): Promise<ExecuteAgentResult>;
}

const { executeAgent } = proxyActivities<WorkItemActivities>({
  startToCloseTimeout: "2 hours",
  heartbeatTimeout: "2 minutes",
  retry: { maximumAttempts: 1 },
});

export const workItemStateQuery = defineQuery<WorkItemState>("state");

export async function WorkItemWorkflow(input: WorkItemInput): Promise<WorkItemState> {
  let state: WorkItemState = {
    taskId: input.taskId,
    phase: "agent",
    workspacePath: input.repositoryRoot,
    feedbackRound: 0,
  };
  setHandler(workItemStateQuery, () => state);

  try {
    const result = await executeAgent({
      task: `${input.title}\n\n${input.context}`,
      workspacePath: input.repositoryRoot,
      policy: input.policy,
    });
    if (!result.completed) throw new Error("agent did not complete the work item");
    state = { ...state, phase: "completed" };
    return state;
  } catch (error) {
    state = { ...state, phase: "failed", failure: error instanceof Error ? error.message : String(error) };
    throw error;
  }
}
