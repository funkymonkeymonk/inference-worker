import type { DispatcherState, WorkItemState } from "../types.js";

export interface UiHistoryEvent {
  eventId: string;
  type: string;
  time?: string;
}

export interface TemporalExecution {
  workflowId: string;
  runId?: string;
  workflowType?: string;
  status: string;
  startTime?: string;
  closeTime?: string;
  state?: WorkItemState | DispatcherState;
  history: UiHistoryEvent[];
}

export interface YxTask {
  id: string;
  title: string;
  state: string;
  context?: string;
  pullRequestUrl?: string;
}

export interface UiWorkItem {
  taskId: string;
  title: string;
  taskState?: string;
  workflowId: string;
  workflowStatus?: string;
  phase?: string;
  startedAt?: string;
  closedAt?: string;
  failure?: string;
  pullRequestUrl?: string;
  metadataUnavailable?: boolean;
}

export interface OverviewResponse {
  items: UiWorkItem[];
  dispatcher?: DispatcherState;
  refreshedAt: string;
  errors: string[];
}

export interface WorkItemDetail extends UiWorkItem {
  context?: string;
  history: UiHistoryEvent[];
  runId?: string;
}

export interface UiDataSource {
  listExecutions(): Promise<TemporalExecution[]>;
  getExecution(workflowId: string): Promise<TemporalExecution | undefined>;
}

export interface UiTaskSource {
  list(): Promise<YxTask[]>;
  context(id: string): Promise<string>;
}
