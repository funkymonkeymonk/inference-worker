import assert from "node:assert/strict";
import test from "node:test";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { compactDispatcherState, dispatchExclusions, WorkDispatcherWorkflow } from "./dispatcher.js";
import type { DispatchCandidate, WorkItemInput } from "../types.js";

test("excludes active and failed tasks from the next dispatch scan", () => {
  assert.deepEqual(
    dispatchExclusions({ activeTaskIds: ["active"], completedTaskIds: ["done"], failedTaskIds: ["failed"] }),
    ["active", "failed"],
  );
});

test("compacts completed and failed task history before continuing as new", () => {
  assert.deepEqual(
    compactDispatcherState({ activeTaskIds: ["active"], completedTaskIds: ["done"], failedTaskIds: ["failed"] }),
    { activeTaskIds: ["active"], completedTaskIds: [], failedTaskIds: [] },
  );
});

test("runs admitted work items concurrently up to the configured capacity", async () => {
  const environment = await TestWorkflowEnvironment.createLocal();
  let running = 0;
  let maximumRunning = 0;
  const input: WorkItemInput = {
    taskId: "task-template",
    title: "test",
    context: "test",
    repositoryRoot: "/tmp",
    policy: { model: "test", allowedTools: [], maxRunTimeSeconds: 1 },
  };
  const candidates: DispatchCandidate[] = ["one", "two"].map((id) => ({
    id,
    title: input.title,
    context: input.context,
    kind: "implementation",
    workflowInput: { ...input, taskId: id },
  }));
  const worker = await Worker.create({
    connection: environment.nativeConnection,
    namespace: environment.namespace,
    taskQueue: "dispatcher-test",
    workflowsPath: new URL("./index.ts", import.meta.url).pathname,
    activities: {
      listDispatchCandidates: async () => candidates,
      claimTask: async () => undefined,
      markTaskDone: async () => undefined,
      releaseTask: async () => undefined,
      executeAgent: async () => {
        running += 1;
        maximumRunning = Math.max(maximumRunning, running);
        await new Promise((resolve) => setTimeout(resolve, 25));
        running -= 1;
        return { completed: true, text: "done", toolCalls: 0 };
      },
    },
  });
  const run = worker.run();
  try {
    await environment.client.workflow.execute(WorkDispatcherWorkflow, {
      args: [{ maxConcurrentImplementations: 2, runOnce: true }],
      taskQueue: "dispatcher-test",
      workflowId: "dispatcher-concurrency-test",
    });
    assert.equal(maximumRunning, 2);
  } finally {
    worker.shutdown();
    await run;
    await environment.teardown();
  }
});
