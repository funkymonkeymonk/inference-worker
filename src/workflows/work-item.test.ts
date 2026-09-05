import assert from "node:assert/strict";
import test from "node:test";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { WorkItemWorkflow } from "./work-item.js";
import type { ExecuteAgentInput, WorkItemInput } from "../types.js";

test("runs one work item through the agent Activity and returns durable state", async () => {
  const environment = await TestWorkflowEnvironment.createLocal();
  const worker = await Worker.create({
    connection: environment.nativeConnection,
    namespace: environment.namespace,
    taskQueue: "work-item-test",
    workflowsPath: new URL("./work-item.ts", import.meta.url).pathname,
    activities: {
      executeAgent: async (input: ExecuteAgentInput) => ({ completed: true, text: `worked on ${input.task}`, toolCalls: 1 }),
    },
  });
  const input: WorkItemInput = {
    taskId: "yak-123",
    title: "Define contracts",
    context: "Add backend-neutral types.",
    repositoryRoot: "/workspace/project",
    policy: { model: "test-model", allowedTools: ["read"], maxRunTimeSeconds: 60 },
  };
  const run = worker.run();
  try {
    const result = await environment.client.workflow.execute(WorkItemWorkflow, {
      args: [input],
      taskQueue: "work-item-test",
      workflowId: "work-item-test-123",
    });
    assert.deepEqual(result, {
      taskId: "yak-123",
      phase: "completed",
      workspacePath: "/workspace/project",
      feedbackRound: 0,
    });
  } finally {
    worker.shutdown();
    await run;
    await environment.teardown();
  }
});
