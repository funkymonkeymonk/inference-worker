import assert from "node:assert/strict";
import test from "node:test";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { compactDispatcherState, dispatchExclusions, dispatcherActivityStartToCloseTimeout, workItemExecutionTimeout, WorkDispatcherWorkflow } from "./dispatcher.js";
import type { DispatchCandidate, DispatcherInput, DispatcherSplitPolicy, SplitPlan, WorkItemInput } from "../types.js";

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

test("gives planner and split Activities a two-hour Temporal upper bound", () => {
  assert.equal(dispatcherActivityStartToCloseTimeout, "2 hours");
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
    workflowInput: { ...input, taskId: id, title: id === "failed-task" ? "fail task" : "independent task" },
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

interface SplitScenarioOptions {
  enabled?: boolean;
  rootDepth?: number;
  maxRootDepth?: number;
  plannerFailure?: boolean;
  splitFailure?: boolean;
}

async function runSplitScenario(options: SplitScenarioOptions = {}) {
  const environment = await TestWorkflowEnvironment.createLocal();
  const failures: Array<{ id: string; reason: string }> = [];
  const plannerInputs: unknown[] = [];
  const splitInputs: unknown[] = [];
  const input: WorkItemInput = {
    taskId: "task-template",
    title: "test",
    context: "test",
    repositoryRoot: "/tmp",
    policy: { model: "test", allowedTools: [], maxRunTimeSeconds: 1 },
  };
  const candidates: DispatchCandidate[] = ["failed-task", "independent-task"].map((id) => ({
    id,
    title: id === "failed-task" ? "fail task" : "independent task",
    context: "task context",
    kind: "implementation" as const,
    rootDepth: options.rootDepth ?? 2,
    workflowInput: { ...input, taskId: id, title: id === "failed-task" ? "fail task" : "independent task" },
  }));
  const plan: SplitPlan = { proposals: [] };
  const splitPolicy: DispatcherSplitPolicy = {
    enabled: options.enabled ?? true,
    maxRootDepth: options.maxRootDepth ?? 10,
    maxChildren: 5,
    planner: { model: "planner", maxRunTimeSeconds: 5, maxOutputTokens: 100 },
  };
  const dispatcherInput: DispatcherInput = { maxConcurrentImplementations: 2, runOnce: true, splitPolicy };
  const worker = await Worker.create({
    connection: environment.nativeConnection,
    namespace: environment.namespace,
    taskQueue: "dispatcher-split-test",
    workflowsPath: new URL("./index.ts", import.meta.url).pathname,
    activities: {
      createWorkspace: async () => ({ workspacePath: "/tmp/work-item", workspaceName: "run", workspaceMode: "jj" }),
      cleanupWorkspace: async () => undefined,
      listDispatchCandidates: async () => candidates,
      claimTask: async () => undefined,
      markTaskDone: async () => undefined,
      recordTaskFailure: async (id: string, reason: string) => { failures.push({ id, reason }); },
      executeAgent: async (agentInput: { task: string }) => {
        if (agentInput.task.includes("fail task")) throw new Error("agent failed");
        return { completed: true, text: "done", toolCalls: 0 };
      },
      planYakSplit: async (plannerInput: unknown) => {
        plannerInputs.push(plannerInput);
        if (options.plannerFailure) throw new Error("planner failed");
        return plan;
      },
      splitTask: async (splitInput: unknown) => {
        splitInputs.push(splitInput);
        if (options.splitFailure) throw new Error("split failed");
      },
    },
  });
  const run = worker.run();
  try {
    const result = await environment.client.workflow.execute(WorkDispatcherWorkflow, {
      args: [dispatcherInput],
      taskQueue: "dispatcher-split-test",
      workflowId: `dispatcher-split-${Math.random()}`,
    });
    return { result, failures, plannerInputs, splitInputs };
  } finally {
    worker.shutdown();
    await run;
    await environment.teardown();
  }
}

test("plans and splits a failed child while continuing an independent sibling", async () => {
  const scenario = await runSplitScenario();
  assert.deepEqual(scenario.result.failedTaskIds, ["failed-task"]);
  assert.deepEqual(scenario.result.completedTaskIds, ["independent-task"]);
  assert.deepEqual(scenario.failures, [{ id: "failed-task", reason: "agent failed" }]);
  assert.deepEqual(scenario.plannerInputs, [{
    title: "fail task",
    context: "task context",
    failureReason: "agent failed",
    currentRootDepth: 2,
    maxRootDepth: 10,
    maxChildren: 5,
    policy: { model: "planner", maxRunTimeSeconds: 5, maxOutputTokens: 100 },
  }]);
  assert.deepEqual(scenario.splitInputs, [{ taskId: "failed-task", failureReason: "agent failed", plan: { proposals: [] } }]);
});

test("does not plan when automatic splitting is disabled", async () => {
  const scenario = await runSplitScenario({ enabled: false });
  assert.deepEqual(scenario.plannerInputs, []);
  assert.deepEqual(scenario.splitInputs, []);
});

test("does not plan a child at the configured maximum depth", async () => {
  const scenario = await runSplitScenario({ rootDepth: 10, maxRootDepth: 10 });
  assert.deepEqual(scenario.plannerInputs, []);
  assert.deepEqual(scenario.splitInputs, []);
});

test("planner failure leaves the failed parent recorded and does not fail the dispatcher", async () => {
  const scenario = await runSplitScenario({ plannerFailure: true });
  assert.deepEqual(scenario.result.failedTaskIds, ["failed-task"]);
  assert.deepEqual(scenario.result.completedTaskIds, ["independent-task"]);
  assert.deepEqual(scenario.failures, [{ id: "failed-task", reason: "agent failed" }]);
  assert.deepEqual(scenario.splitInputs, []);
});

test("split failure leaves the failed parent recorded and does not fail the dispatcher", async () => {
  const scenario = await runSplitScenario({ splitFailure: true });
  assert.deepEqual(scenario.result.failedTaskIds, ["failed-task"]);
  assert.deepEqual(scenario.result.completedTaskIds, ["independent-task"]);
  assert.equal(scenario.plannerInputs.length, 1);
  assert.equal(scenario.splitInputs.length, 1);
});
