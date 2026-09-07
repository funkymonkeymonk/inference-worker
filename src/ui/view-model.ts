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
    type: eventTypeName(event.eventType ?? event.type),
    ...(event.eventTime ? { time: eventTimeValue(event.eventTime) } : {}),
  }));
}

const EVENT_TYPE_NAMES: Record<number, string> = {
  1: "WorkflowExecutionStarted",
  2: "WorkflowExecutionCompleted",
  3: "WorkflowExecutionFailed",
  4: "WorkflowExecutionTimedOut",
  5: "WorkflowTaskScheduled",
  6: "WorkflowTaskStarted",
  7: "WorkflowTaskCompleted",
  8: "WorkflowTaskTimedOut",
  9: "WorkflowTaskFailed",
  10: "ActivityTaskScheduled",
  11: "ActivityTaskStarted",
  12: "ActivityTaskCompleted",
  13: "ActivityTaskFailed",
  14: "ActivityTaskTimedOut",
  15: "ActivityTaskCancelRequested",
  16: "ActivityTaskCanceled",
};

function eventTypeName(value: unknown): string {
  if (typeof value === "number") return EVENT_TYPE_NAMES[value] ?? `EventType(${value})`;
  return String(value ?? "Unknown");
}

function eventTimeValue(value: unknown): string {
  if (!value || typeof value !== "object" || !("seconds" in value)) return String(value);
  const timestamp = value as { seconds: unknown; nanos?: unknown };
  const secondsValue = timestamp.seconds;
  const seconds = secondsValue && typeof secondsValue === "object" && "toNumber" in secondsValue && typeof secondsValue.toNumber === "function"
    ? secondsValue.toNumber()
    : Number(secondsValue);
  const nanos = Number(timestamp.nanos ?? 0);
  return new Date(seconds * 1000 + nanos / 1_000_000).toISOString();
}
