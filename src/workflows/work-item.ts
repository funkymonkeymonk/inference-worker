import { CancellationScope, defineQuery, log, proxyActivities, setHandler } from "@temporalio/workflow";
import type { ExecuteAgentInput, ExecuteAgentResult, WorkItemInput, WorkItemState } from "../types.js";
import type { CleanupWorkspaceInput, CreateWorkspaceInput, WorkspaceInfo } from "../activities/workspace.js";

interface WorkItemActivities {
  createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceInfo>;
  cleanupWorkspace(input: CleanupWorkspaceInput): Promise<void>;
  executeAgent(input: ExecuteAgentInput): Promise<ExecuteAgentResult>;
}

function failureMessage(error: unknown): string {
  if (error instanceof Error && error.cause) return failureMessage(error.cause);
  return error instanceof Error ? error.message : String(error);
}

const { createWorkspace, cleanupWorkspace, executeAgent } = proxyActivities<WorkItemActivities>({
  startToCloseTimeout: "2 hours",
  heartbeatTimeout: "2 minutes",
  retry: { maximumAttempts: 1 },
});

export const workItemStateQuery = defineQuery<WorkItemState>("state");

export async function WorkItemWorkflow(input: WorkItemInput): Promise<WorkItemState> {
  let state: WorkItemState = {
    taskId: input.taskId,
    phase: "agent",
    feedbackRound: 0,
  };
  setHandler(workItemStateQuery, () => state);

  let workspace: WorkspaceInfo | undefined;
  let primaryFailure: unknown;
  try {
    workspace = await createWorkspace({ repositoryRoot: input.repositoryRoot, taskId: input.taskId });
    state = { ...state, workspacePath: workspace.workspacePath };
    const result = await executeAgent({
      task: `${input.title}\n\n${input.context}`,
      workspacePath: workspace.workspacePath,
      policy: input.policy,
    });
    if (!result.completed) throw new Error("agent did not complete the work item");
    state = { ...state, phase: "completed" };
    return state;
  } catch (error) {
    primaryFailure = error;
    state = { ...state, phase: "failed", failure: error instanceof Error ? error.message : String(error) };
    throw error;
  } finally {
    if (workspace) {
      const workspaceInfo = workspace;
      try {
        await CancellationScope.nonCancellable(() => cleanupWorkspace({
          ...workspaceInfo,
          repositoryRoot: input.repositoryRoot,
        }));
      } catch (cleanupError) {
        if (primaryFailure !== undefined) {
          log.error("workspace cleanup failed after WorkItem failure", {
            taskId: input.taskId,
            workspacePath: workspaceInfo.workspacePath,
            error: failureMessage(cleanupError),
          });
        } else {
          throw cleanupError;
        }
      }
    }
  }
}
