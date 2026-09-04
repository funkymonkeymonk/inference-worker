import assert from "node:assert/strict";
import test from "node:test";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { modelForRequestType } from "../policy/model-routing.js";
import { InferenceWorkflow } from "./inference.js";
import type { InferenceRequest } from "../types.js";

test("routes each request type to its workflow-owned model", () => {
  assert.equal(modelForRequestType("fast"), "omlx/qwen3.8-27b");
  assert.equal(modelForRequestType("reasoning"), "omlx/qwen3.8-27b");
  assert.equal(modelForRequestType("agent"), "omlx/qwen3.8-27b");
});

test("executes through a Temporal worker and returns a serialized result", async () => {
  const environment = await TestWorkflowEnvironment.createLocal();
  const worker = await Worker.create({
    connection: environment.nativeConnection,
    namespace: environment.namespace,
    taskQueue: "workflow-test",
    workflowsPath: new URL("./inference.ts", import.meta.url).pathname,
    activities: {
      executeInference: async ({ model }: { model: string }) => ({ text: "ok", model }),
    },
  });
  const request: InferenceRequest = { requestType: "reasoning", messages: [{ role: "user", content: "test" }] };
  const run = worker.run();
  try {
    const result = await environment.client.workflow.execute(InferenceWorkflow, {
      args: [request],
      taskQueue: "workflow-test",
      workflowId: "inference-workflow-test",
    });
    assert.deepEqual(result, { text: "ok", model: "omlx/qwen3.8-27b" });
  } finally {
    worker.shutdown();
    await run;
    await environment.teardown();
  }
});
