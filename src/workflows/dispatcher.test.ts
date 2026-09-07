import assert from "node:assert/strict";
import test from "node:test";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { compactDispatcherState, dispatchExclusions, workItemExecutionTimeout, WorkDispatcherWorkflow } from "./dispatcher.js";
import type { DispatchCandidate, WorkItemInput } from "../types.js";

test("excludes active tasks while backend tags control failed-task blocking", () => {
  assert.deepEqual(
    dispatchExclusions({ activeTaskIds: ["active"], completedTaskIds: ["done"], failedTaskIds: ["failed"] }),
    ["active"],
  );
});

test("compacts completed and failed task history before continuing as new", () => {
  assert.deepEqual(
    compactDispatcherState({ activeTaskIds: ["active"], completedTaskIds: ["done"], failedTaskIds: ["failed"] }),
    { activeTaskIds: ["active"], completedTaskIds: [], failedTaskIds: [] },
  );
});

test("derives the child workflow execution timeout from the candidate policy", () => {
  assert.equal(workItemExecutionTimeout({ policy: { model: "test", allowedTools: [], maxRunTimeSeconds: 17, cleanupGraceSeconds: 13 } }), 30_000);
  assert.equal(workItemExecutionTimeout({ policy: { model: "test", allowedTools: [], maxRunTimeSeconds: 17 } }), 317_000);
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
      createWorkspace: async () => ({ workspacePath: "/tmp/work-item", workspaceName: "run", workspaceMode: "jj" }),
      cleanupWorkspace: async () => undefined,
      listDispatchCandidates: async () => candidates,
      claimTask: async () => undefined,
      markTaskDone: async () => undefined,
       recordTaskFailure: async () => undefined,
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

test("records failed implementations and continues the run-once dispatch", async () => {
  const environment = await TestWorkflowEnvironment.createLocal();
  const failures: Array<{ id: string; reason: string }> = [];
  const input: WorkItemInput = {
    taskId: "task-template",
    title: "test",
    context: "test",
    repositoryRoot: "/tmp",
    policy: { model: "test", allowedTools: [], maxRunTimeSeconds: 1 },
  };
  const worker = await Worker.create({
    connection: environment.nativeConnection,
    namespace: environment.namespace,
    taskQueue: "dispatcher-failure-test",
    workflowsPath: new URL("./index.ts", import.meta.url).pathname,
    activities: {
      createWorkspace: async () => ({ workspacePath: "/tmp/work-item", workspaceName: "run", workspaceMode: "jj" }),
      cleanupWorkspace: async () => undefined,
      listDispatchCandidates: async () => [{
        id: "failed-task",
        title: input.title,
        context: input.context,
        kind: "implementation" as const,
        workflowInput: { ...input, taskId: "failed-task" },
      }],
      claimTask: async () => undefined,
      markTaskDone: async () => undefined,
      recordTaskFailure: async (id: string, reason: string) => { failures.push({ id, reason }); },
      executeAgent: async () => { throw new Error("agent failed"); },
    },
  });
  const run = worker.run();
  try {
    const result = await environment.client.workflow.execute(WorkDispatcherWorkflow, {
      args: [{ maxConcurrentImplementations: 1, runOnce: true }],
      taskQueue: "dispatcher-failure-test",
      workflowId: "dispatcher-failure-test",
    });
    assert.deepEqual(result.failedTaskIds, ["failed-task"]);
    assert.deepEqual(failures, [{ id: "failed-task", reason: "agent failed" }]);
  } finally {
    worker.shutdown();
    await run;
    await environment.teardown();
  }
});
