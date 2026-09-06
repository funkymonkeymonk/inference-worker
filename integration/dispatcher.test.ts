import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Connection, Client } from "@temporalio/client";
import { NativeConnection, Worker } from "@temporalio/worker";
import * as baseActivities from "../dist/activities/index.js";
import { WorkDispatcherWorkflow } from "../dist/workflows/dispatcher.js";
import type { DispatchCandidate } from "../dist/types.js";
import { temporalAddressFromEnvironment } from "../dist/temporal-address.js";

const temporalAddress = process.env.INTEGRATION_TEMPORAL_ADDRESS ?? temporalAddressFromEnvironment();
const temporalNamespace = process.env.INTEGRATION_TEMPORAL_NAMESPACE ?? process.env.TEMPORAL_NAMESPACE ?? "inference";

function sse(events: unknown[]): string {
  return `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`;
}

test("dispatcher admits a backend candidate into a WorkItem child workflow", async () => {
  const workspacePath = await mkdtemp(path.join(os.tmpdir(), "inference-worker-dispatcher-"));
  await writeFile(path.join(workspacePath, "notes.txt"), "dispatcher notes");
  const inferenceServer = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const parsed = JSON.parse(body) as { messages: Array<{ role: string }> };
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(parsed.messages.some((message) => message.role === "tool")
      ? sse([{ choices: [{ delta: { content: "dispatcher notes" } }] }, { choices: [{ finish_reason: "stop", delta: {} }] }])
      : sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: "call-dispatch", type: "function", function: { name: "read", arguments: '{"path":"notes.txt"}' } }] } }] }, { choices: [{ finish_reason: "tool_calls", delta: {} }] }]));
  });
  await new Promise<void>((resolve) => inferenceServer.listen(0, "127.0.0.1", resolve));
  const port = (inferenceServer.address() as { port: number }).port;
  const previousEndpoint = process.env.INFERENCE_ENDPOINT;
  process.env.INFERENCE_ENDPOINT = `http://127.0.0.1:${port}/v1`;
  const candidate: DispatchCandidate = {
    id: "dispatcher-candidate",
    title: "Read dispatcher fixture",
    context: "Use the read tool.",
    kind: "implementation",
    workflowInput: {
      taskId: "dispatcher-candidate",
      title: "Read dispatcher fixture",
      context: "Use the read tool.",
      repositoryRoot: workspacePath,
      policy: { model: "integration-model", allowedTools: ["read"], maxRunTimeSeconds: 30 },
    },
  };
  const calls: string[] = [];
  const activities = {
    ...baseActivities,
    listDispatchCandidates: async () => [candidate],
    claimTask: async (id: string) => { calls.push(`claim:${id}`); },
    releaseTask: async (id: string) => { calls.push(`release:${id}`); },
    markTaskDone: async (id: string) => { calls.push(`done:${id}`); },
  };
  let nativeConnection: NativeConnection | undefined;
  let clientConnection: Connection | undefined;
  let worker: Worker | undefined;
  try {
    nativeConnection = await NativeConnection.connect({ address: temporalAddress });
    clientConnection = await Connection.connect({ address: temporalAddress });
    const taskQueue = `integration-dispatcher-${process.pid}-${Date.now()}`;
    worker = await Worker.create({
      connection: nativeConnection,
      namespace: temporalNamespace,
      taskQueue,
      workflowsPath: new URL("../dist/workflows/index.js", import.meta.url).pathname,
      activities,
      maxConcurrentActivityTaskExecutions: 1,
    });
    const workerRun = worker.run();
    try {
      const client = new Client({ connection: clientConnection, namespace: temporalNamespace });
      const result = await client.workflow.execute(WorkDispatcherWorkflow, {
        args: [{ maxConcurrentImplementations: 1, runOnce: true }],
        taskQueue,
        workflowId: `integration-dispatcher-${Date.now()}`,
      });
      assert.deepEqual(calls, ["claim:dispatcher-candidate", "done:dispatcher-candidate"]);
      assert.deepEqual(result.completedTaskIds, ["dispatcher-candidate"]);
    } finally {
      await worker.shutdown();
      await workerRun;
    }
  } finally {
    if (previousEndpoint === undefined) delete process.env.INFERENCE_ENDPOINT;
    else process.env.INFERENCE_ENDPOINT = previousEndpoint;
    await nativeConnection?.close();
    await clientConnection?.close();
    await new Promise<void>((resolve, reject) => inferenceServer.close((error) => error ? reject(error) : resolve()));
  }
});
