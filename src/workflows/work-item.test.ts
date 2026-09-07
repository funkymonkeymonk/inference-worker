import assert from "node:assert/strict";
import test from "node:test";
import { Context } from "@temporalio/activity";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { WorkItemWorkflow } from "./work-item.js";
import type { ExecuteAgentInput, WorkItemInput } from "../types.js";

function errorChainMessages(error: unknown): string[] {
  const messages: string[] = [];
  let current = error;
  while (current instanceof Error) {
    messages.push(current.message);
    current = current.cause;
  }
  return messages;
}

test("runs one work item through the agent Activity and returns durable state", async () => {
  const environment = await TestWorkflowEnvironment.createLocal();
  const agentInputs: ExecuteAgentInput[] = [];
  const cleaned: string[] = [];
  const worker = await Worker.create({
    connection: environment.nativeConnection,
    namespace: environment.namespace,
    taskQueue: "work-item-test",
    workflowsPath: new URL("./work-item.ts", import.meta.url).pathname,
    activities: {
      createWorkspace: async () => ({ workspacePath: "/tmp/work-item-run", workspaceName: "run-1" }),
      cleanupWorkspace: async (input: { workspacePath: string }) => { cleaned.push(input.workspacePath); },
      executeAgent: async (input: ExecuteAgentInput) => {
        agentInputs.push(input);
        return { completed: true, text: `worked on ${input.task}`, toolCalls: 1 };
      },
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
       workspacePath: "/tmp/work-item-run",
       feedbackRound: 0,
     });
    assert.equal(agentInputs[0].workspacePath, "/tmp/work-item-run");
    assert.deepEqual(cleaned, ["/tmp/work-item-run"]);
  } finally {
    worker.shutdown();
    await run;
    await environment.teardown();
  }
});

async function runFailureScenario(executeAgent: () => Promise<never>): Promise<string[]> {
  const environment = await TestWorkflowEnvironment.createLocal();
  const cleaned: string[] = [];
  const worker = await Worker.create({
    connection: environment.nativeConnection,
    namespace: environment.namespace,
    taskQueue: "work-item-failure-test",
    workflowsPath: new URL("./work-item.ts", import.meta.url).pathname,
    activities: {
      createWorkspace: async () => ({ workspacePath: "/tmp/work-item-failure", workspaceName: "run-failure" }),
      cleanupWorkspace: async (input: { workspacePath: string }) => { cleaned.push(input.workspacePath); },
      executeAgent,
    },
  });
  const run = worker.run();
  try {
    await assert.rejects(environment.client.workflow.execute(WorkItemWorkflow, {
      args: [{
        taskId: "yak-failure",
        title: "Fail",
        context: "Fail",
        repositoryRoot: "/workspace/project",
        policy: { model: "test-model", allowedTools: ["read"], maxRunTimeSeconds: 60 },
      }],
      taskQueue: "work-item-failure-test",
      workflowId: `work-item-failure-${Date.now()}`,
    }));
    return cleaned;
  } finally {
    worker.shutdown();
    await run;
    await environment.teardown();
  }
}

test("cleans the isolated workspace when the agent fails", async () => {
  assert.deepEqual(await runFailureScenario(async () => { throw new Error("agent failed"); }), ["/tmp/work-item-failure"]);
});

test("preserves the agent failure when workspace cleanup also fails", async () => {
  const environment = await TestWorkflowEnvironment.createLocal();
  const worker = await Worker.create({
    connection: environment.nativeConnection,
    namespace: environment.namespace,
    taskQueue: "work-item-cleanup-failure-test",
    workflowsPath: new URL("./work-item.ts", import.meta.url).pathname,
    activities: {
      createWorkspace: async () => ({ workspacePath: "/tmp/work-item-cleanup-failure", workspaceName: "run-cleanup-failure" }),
      cleanupWorkspace: async () => { throw new Error("cleanup failed"); },
      executeAgent: async () => { throw new Error("agent failed"); },
    },
  });
  const run = worker.run();
  try {
    await assert.rejects(
      environment.client.workflow.execute(WorkItemWorkflow, {
        args: [{
          taskId: "yak-cleanup-failure",
          title: "Fail",
          context: "Fail",
          repositoryRoot: "/workspace/project",
          policy: { model: "test-model", allowedTools: ["read"], maxRunTimeSeconds: 60 },
        }],
        taskQueue: "work-item-cleanup-failure-test",
        workflowId: "work-item-cleanup-failure",
      }),
      (error: unknown) => {
        const messages = errorChainMessages(error);
        return messages.some((message) => message.includes("agent failed"))
          && !messages.some((message) => message.includes("cleanup failed"));
      },
    );
  } finally {
    worker.shutdown();
    await run;
    await environment.teardown();
  }
});

test("cleans the isolated workspace when the workflow is cancelled", async () => {
  const environment = await TestWorkflowEnvironment.createLocal();
  const cleaned: string[] = [];
  let agentStarted!: () => void;
  const agentStartedPromise = new Promise<void>((resolve) => { agentStarted = resolve; });
  const worker = await Worker.create({
    connection: environment.nativeConnection,
    namespace: environment.namespace,
    taskQueue: "work-item-cancel-test",
    workflowsPath: new URL("./work-item.ts", import.meta.url).pathname,
    activities: {
      createWorkspace: async () => ({ workspacePath: "/tmp/work-item-cancel", workspaceName: "run-cancel" }),
      cleanupWorkspace: async (input: { workspacePath: string }) => { cleaned.push(input.workspacePath); },
      executeAgent: async () => {
        agentStarted();
        return await new Promise<never>((_resolve, reject) => {
          Context.current().cancellationSignal.addEventListener("abort", () => reject(new Error("agent cancelled")));
        });
      },
    },
  });
  const run = worker.run();
  try {
    const handle = await environment.client.workflow.start(WorkItemWorkflow, {
      args: [{
        taskId: "yak-cancel",
        title: "Cancel",
        context: "Cancel",
        repositoryRoot: "/workspace/project",
        policy: { model: "test-model", allowedTools: ["read"], maxRunTimeSeconds: 60 },
      }],
      taskQueue: "work-item-cancel-test",
      workflowId: "work-item-cancel",
    });
    await agentStartedPromise;
    await handle.cancel();
    await assert.rejects(handle.result());
    assert.deepEqual(cleaned, ["/tmp/work-item-cancel"]);
  } finally {
    worker.shutdown();
    await run;
    await environment.teardown();
  }
});
