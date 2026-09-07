import type { DispatcherState, WorkItemState } from "../types.js";
import type { OverviewResponse, TemporalExecution, UiHistoryEvent, UiWorkItem, WorkItemDetail, YxTask } from "./types.js";

function taskIdFromWorkflow(workflowId: string): string | undefined {
  return workflowId.startsWith("work-item-") ? workflowId.slice("work-item-".length) : undefined;
}

function workItemState(execution: TemporalExecution): WorkItemState | undefined {
  return execution.state && "taskId" in execution.state ? execution.state : undefined;
}

function itemFrom(execution: TemporalExecution, task?: YxTask): UiWorkItem | undefined {
  const taskId = task?.id ?? taskIdFromWorkflow(execution.workflowId);
  if (!taskId) return undefined;
  const state = workItemState(execution);
  return {
    taskId,
    title: task?.title ?? taskId,
    workflowId: execution.workflowId,
    ...(task?.state ? { taskState: task.state } : {}),
    ...(execution.status ? { workflowStatus: execution.status } : {}),
    ...(state?.phase ? { phase: state.phase } : {}),
    ...(execution.startTime ? { startedAt: execution.startTime } : {}),
    ...(execution.closeTime ? { closedAt: execution.closeTime } : {}),
    ...(state?.failure ? { failure: state.failure } : {}),
    ...((task?.pullRequestUrl ?? state?.pullRequestUrl) ? { pullRequestUrl: task?.pullRequestUrl ?? state?.pullRequestUrl } : {}),
    ...(task ? {} : { metadataUnavailable: true }),
  };
}

export function buildOverview(executions: TemporalExecution[], tasks: YxTask[], dispatcher?: DispatcherState, errors: string[] = []): OverviewResponse {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const items = executions
    .filter((execution) => execution.workflowId.startsWith("work-item-"))
    .map((execution) => itemFrom(execution, taskById.get(taskIdFromWorkflow(execution.workflowId) ?? "")))
    .filter((item): item is UiWorkItem => item !== undefined);
  return { items, ...(dispatcher ? { dispatcher } : {}), refreshedAt: new Date().toISOString(), errors };
}

export function buildWorkItemDetail(execution: TemporalExecution, task?: YxTask, context?: string): WorkItemDetail {
  const item = itemFrom(execution, task);
  if (!item) throw new Error(`workflow is not a work item: ${execution.workflowId}`);
  return { ...item, context: context ?? task?.context, history: execution.history, runId: execution.runId };
}

export function isDispatcherState(value: TemporalExecution["state"]): value is DispatcherState {
  return Boolean(value && "activeTaskIds" in value && !("taskId" in value));
}

export function historyEvents(value: unknown): UiHistoryEvent[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as { events?: unknown }).events)) return [];
  return (value as { events: Array<Record<string, unknown>> }).events.map((event, index) => ({
    eventId: String(event.eventId ?? index + 1),
    type: String(event.eventType ?? event.type ?? "Unknown"),
    ...(event.eventTime ? { time: String(event.eventTime) } : {}),
  }));
}
