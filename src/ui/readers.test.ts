import assert from "node:assert/strict";
import test from "node:test";
import { YxUiReader } from "./yx-reader.js";
import { TemporalUiReader } from "./temporal-reader.js";

test("yx UI reader only performs read-only commands", async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const reader = new YxUiReader(async (command, args) => {
    calls.push({ command, args });
    return command === "yx" && args[0] === "list" ? JSON.stringify([{ id: "yak-1", name: "Task", state: "todo" }]) : "context";
  });

  assert.deepEqual(await reader.list(), [{ id: "yak-1", title: "Task", state: "todo" }]);
  assert.equal(await reader.context("yak-1"), "context");
  assert.deepEqual(calls, [
    { command: "yx", args: ["list", "--format", "json"] },
    { command: "yx", args: ["context", "yak-1", "--show"] },
  ]);
});

test("Temporal overview listing does not query historical workflow executions", async () => {
  const queried: string[] = [];
  const client = {
    list: async function* () {
      yield { workflowId: "work-item-running", runId: "run-1", type: "WorkItemWorkflow", status: { code: 1, name: "RUNNING" }, startTime: new Date() };
      yield { workflowId: "work-item-old", runId: "run-2", type: "WorkItemWorkflow", status: { code: 2, name: "COMPLETED" }, startTime: new Date(), closeTime: new Date() };
    },
    getHandle(id: string) {
      queried.push(id);
      return { query: async () => ({ taskId: "running", phase: "agent", feedbackRound: 0 }), fetchHistory: async () => ({ events: [] }) };
    },
  } as never;

  const executions = await new TemporalUiReader(client).listExecutions();

  assert.equal(executions.length, 2);
  assert.equal(executions[0]?.status, "RUNNING");
  assert.deepEqual(queried, ["work-item-running"]);
});
