import assert from "node:assert/strict";
import test from "node:test";
import { buildOverview, buildWorkItemDetail, historyEvents } from "./view-model.js";
import type { TemporalExecution, YxTask } from "./types.js";

const execution: TemporalExecution = {
  workflowId: "work-item-yak-1",
  runId: "run-1",
  status: "RUNNING",
  startTime: "2026-09-07T12:00:00.000Z",
  state: { taskId: "yak-1", phase: "agent", feedbackRound: 0 },
  history: [{ eventId: "1", type: "WorkflowExecutionStarted" }],
};

const task: YxTask = {
  id: "yak-1",
  title: "Implement the feature",
  state: "doing",
  context: "# Goal\nBuild it",
};

test("builds an overview item from correlated workflow and yak data", () => {
  const overview = buildOverview([execution], [task], { activeTaskIds: ["yak-1"], completedTaskIds: [], failedTaskIds: [] });

  assert.equal(overview.items.length, 1);
  assert.deepEqual(overview.items[0], {
    taskId: "yak-1",
    title: "Implement the feature",
    taskState: "doing",
    workflowId: "work-item-yak-1",
    workflowStatus: "RUNNING",
    phase: "agent",
    startedAt: "2026-09-07T12:00:00.000Z",
  });
});

test("keeps historical workflow data visible when yak metadata is unavailable", () => {
  const overview = buildOverview([execution], [], { activeTaskIds: ["yak-1"], completedTaskIds: [], failedTaskIds: [] });

  assert.equal(overview.items[0]?.title, "yak-1");
  assert.equal(overview.items[0]?.metadataUnavailable, true);
});

test("builds a detail record with task context and execution history", () => {
  const detail = buildWorkItemDetail(execution, task);

  assert.equal(detail.taskId, "yak-1");
  assert.equal(detail.context, "# Goal\nBuild it");
  assert.deepEqual(detail.history, [{ eventId: "1", type: "WorkflowExecutionStarted" }]);
});

test("renders Temporal numeric event types and protobuf timestamps as readable values", () => {
  assert.deepEqual(historyEvents({ events: [{ eventId: { toString: () => "7" }, eventType: 1, eventTime: { seconds: { toNumber: () => 1788820073 }, nanos: 0 } }] }), [
    { eventId: "7", type: "WorkflowExecutionStarted", time: "2026-09-07T22:27:53.000Z" },
  ]);
});
