import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Connection, Client } from "@temporalio/client";
import { NativeConnection, Worker } from "@temporalio/worker";
import * as activities from "../dist/activities/index.js";
import { WorkItemWorkflow } from "../dist/workflows/work-item.js";
import { temporalAddressFromEnvironment } from "../dist/temporal-address.js";

const temporalAddress = process.env.INTEGRATION_TEMPORAL_ADDRESS ?? temporalAddressFromEnvironment();
const temporalNamespace = process.env.INTEGRATION_TEMPORAL_NAMESPACE ?? process.env.TEMPORAL_NAMESPACE ?? "inference";

function sse(events: unknown[]): string {
  return `${events.map((event) => `data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`;
}

async function listen(server: ReturnType<typeof createServer>): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as { port: number }).port;
}

test("executes WorkItemWorkflow through a real Temporal worker and tool call", async () => {
  const workspacePath = await mkdtemp(path.join(os.tmpdir(), "inference-worker-integration-"));
  await writeFile(path.join(workspacePath, "notes.txt"), "integration notes");
  let requestCount = 0;
  const inferenceServer = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const parsed = JSON.parse(body) as { messages: Array<{ role: string }> };
    requestCount += 1;
    response.writeHead(200, { "content-type": "text/event-stream" });
    if (parsed.messages.some((message) => message.role === "tool")) {
      response.end(sse([
        { choices: [{ delta: { content: "The file says integration notes." } }] },
        { choices: [{ finish_reason: "stop", delta: {} }] },
      ]));
    } else {
      response.end(sse([
        { choices: [{ delta: { tool_calls: [{ index: 0, id: "call-integration", type: "function", function: { name: "read", arguments: '{"path":"notes.txt"}' } }] } }] },
        { choices: [{ finish_reason: "tool_calls", delta: {} }] },
      ]));
    }
  });
  const inferencePort = await listen(inferenceServer);
  const previousEndpoint = process.env.INFERENCE_ENDPOINT;
  process.env.INFERENCE_ENDPOINT = `http://127.0.0.1:${inferencePort}/v1`;
  const taskQueue = `integration-${process.pid}-${Date.now()}`;
  let nativeConnection: NativeConnection | undefined;
  let clientConnection: Connection | undefined;
  let worker: Worker | undefined;
  try {
    try {
      nativeConnection = await NativeConnection.connect({ address: temporalAddress });
      clientConnection = await Connection.connect({ address: temporalAddress });
    } catch (error) {
      throw new Error(`Temporal is unavailable at ${temporalAddress}; run 'devenv up -d' or set INTEGRATION_TEMPORAL_ADDRESS`, { cause: error });
    }
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
      const result = await client.workflow.execute(WorkItemWorkflow, {
        args: [{
          taskId: "integration-work-item",
          title: "Read the integration fixture",
          context: "Use the read tool and report the file contents.",
          repositoryRoot: workspacePath,
          policy: { model: "integration-model", allowedTools: ["read"], maxRunTimeSeconds: 30 },
        }],
        taskQueue,
        workflowId: `integration-work-item-${Date.now()}`,
      });
      assert.equal(result.phase, "completed");
      assert.equal(requestCount, 2);
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
