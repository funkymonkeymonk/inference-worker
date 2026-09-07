import type { WorkflowClient, WorkflowExecutionInfo } from "@temporalio/client";
import type { DispatcherState, WorkItemState } from "../types.js";
import { historyEvents } from "./view-model.js";
import type { TemporalExecution, UiDataSource } from "./types.js";

type QueryableHandle = { query<T>(query: string): Promise<T>; fetchHistory(): Promise<unknown> };

function statusName(status: unknown): string {
  if (typeof status === "string") return status;
  if (status && typeof status === "object" && "name" in status) return String(status.name);
  return String(status);
}

function executionInfo(info: Pick<WorkflowExecutionInfo, "workflowId" | "runId" | "type" | "status" | "startTime" | "closeTime">): TemporalExecution {
  return {
    workflowId: info.workflowId,
    runId: info.runId,
    workflowType: info.type,
    status: statusName(info.status),
    startTime: info.startTime?.toISOString(),
    closeTime: info.closeTime?.toISOString(),
    history: [],
  };
}

export class TemporalUiReader implements UiDataSource {
  constructor(private readonly client: WorkflowClient) {}

  async listExecutions(): Promise<TemporalExecution[]> {
    const executions: TemporalExecution[] = [];
    for await (const info of this.client.list({ query: "WorkflowType = 'WorkItemWorkflow' OR WorkflowType = 'WorkDispatcherWorkflow'" })) {
      executions.push(executionInfo(info));
    }
    return Promise.all(executions.map(async (execution) => this.enrich(execution, execution.status === "RUNNING", false)));
  }

  async getExecution(workflowId: string): Promise<TemporalExecution | undefined> {
    try {
      const execution = executionInfo(await this.client.getHandle(workflowId).describe());
      return this.enrich(execution, execution.status === "RUNNING", true);
    } catch {
      return undefined;
    }
  }

  private async enrich(execution: TemporalExecution, queryState: boolean, includeHistory: boolean): Promise<TemporalExecution> {
    if (!queryState && !includeHistory) return execution;
    const handle = this.client.getHandle(execution.workflowId) as unknown as QueryableHandle;
    let state: WorkItemState | DispatcherState | undefined;
    if (queryState) {
      try {
        state = execution.workflowType === "WorkDispatcherWorkflow"
          ? await handle.query<DispatcherState>("state")
          : await handle.query<WorkItemState>("state");
      } catch {
        state = undefined;
      }
    }
    if (!includeHistory) return { ...execution, state };
    let history: TemporalExecution["history"] = [];
    try {
      history = historyEvents(await handle.fetchHistory());
    } catch {
      history = [];
    }
    return { ...execution, state, history };
  }
}
