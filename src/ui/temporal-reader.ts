import type { WorkflowClient, WorkflowExecutionInfo } from "@temporalio/client";
import type { DispatcherState, WorkItemState } from "../types.js";
import { historyEvents } from "./view-model.js";
import type { TemporalExecution, UiDataSource } from "./types.js";

type QueryableHandle = { query<T>(query: string): Promise<T>; fetchHistory(): Promise<unknown> };

function executionInfo(info: Pick<WorkflowExecutionInfo, "workflowId" | "runId" | "type" | "status" | "startTime" | "closeTime">): TemporalExecution {
  return {
    workflowId: info.workflowId,
    runId: info.runId,
    workflowType: info.type,
    status: String(info.status),
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
    return Promise.all(executions.map(async (execution) => this.enrich(execution)));
  }

  async getExecution(workflowId: string): Promise<TemporalExecution | undefined> {
    try {
      return this.enrich(executionInfo(await this.client.getHandle(workflowId).describe()));
    } catch {
      return undefined;
    }
  }

  private async enrich(execution: TemporalExecution): Promise<TemporalExecution> {
    const handle = this.client.getHandle(execution.workflowId) as unknown as QueryableHandle;
    let state: WorkItemState | DispatcherState | undefined;
    try {
      state = execution.workflowType === "WorkDispatcherWorkflow"
        ? await handle.query<DispatcherState>("state")
        : await handle.query<WorkItemState>("state");
    } catch {
      state = undefined;
    }
    let history: TemporalExecution["history"] = [];
    try {
      history = historyEvents(await handle.fetchHistory());
    } catch {
      history = [];
    }
    return { ...execution, state, history };
  }
}
