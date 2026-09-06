import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Connection, Client } from "@temporalio/client";
import test from "node:test";

const execFileAsync = promisify(execFile);
const repositoryRoot = process.cwd();
const temporalAddress = process.env.INTEGRATION_TEMPORAL_ADDRESS ?? process.env.TEMPORAL_ADDRESS ?? "127.0.0.1:7233";
const temporalNamespace = process.env.INTEGRATION_TEMPORAL_NAMESPACE ?? process.env.TEMPORAL_NAMESPACE ?? "inference";

function sse(events: unknown[]): string {
  return `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`;
}

async function yx(args: string[]): Promise<string> {
  const result = await execFileAsync("yx", args, { cwd: repositoryRoot, maxBuffer: 4 * 1024 * 1024 });
  return result.stdout;
}

async function waitFor(check: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`condition was not met within ${timeoutMs}ms`);
}

function findYak(nodes: Array<{ name: string; state: string; children?: typeof nodes }>, name: string): { state: string } | undefined {
  for (const node of nodes) {
    if (node.name === name) return node;
    const child = findYak(node.children ?? [], name);
    if (child) return child;
  }
  return undefined;
}

test("devenv worker dispatches and completes a real yak", async () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const yakName = `integration worker shaves yak ${suffix}`;
  const markerName = `.integration-shaved-${suffix}.txt`;
  const markerPath = path.join(repositoryRoot, markerName);
  const dispatcherWorkflowId = `integration-dispatcher-${suffix}`;
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const parsed = JSON.parse(body) as { messages: Array<{ role: string }> };
    response.writeHead(200, { "content-type": "text/event-stream" });
    if (parsed.messages.some((message) => message.role === "tool")) {
      response.end(sse([{ choices: [{ delta: { content: "wrote the integration marker" } }] }, { choices: [{ finish_reason: "stop", delta: {} }] }]));
    } else {
      response.end(sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: "call-worker-integration", type: "function", function: { name: "write", arguments: JSON.stringify({ path: markerName, content: "worker integration complete\n" }) } }] } }] }, { choices: [{ finish_reason: "tool_calls", delta: {} }] }]));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const inferencePort = (server.address() as { port: number }).port;
  let worker: ReturnType<typeof spawn> | undefined;
  let workerOutput = "";
  try {
    await yx(["add", yakName, "--state", "todo", "--context", `Use the write tool to create ${markerName} with the integration marker content.`]);
    await yx(["tag", "add", yakName, "@g2g", "@priority:999"]);
    worker = spawn(process.execPath, [path.join(repositoryRoot, "dist/worker.js")], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        TEMPORAL_ADDRESS: process.env.INTEGRATION_TEMPORAL_ADDRESS ?? process.env.TEMPORAL_ADDRESS ?? "127.0.0.1:7233",
        TEMPORAL_NAMESPACE: process.env.INTEGRATION_TEMPORAL_NAMESPACE ?? process.env.TEMPORAL_NAMESPACE ?? "inference",
        TEMPORAL_TASK_QUEUE: `integration-worker-${suffix}`,
        DISPATCHER_WORKFLOW_ID: dispatcherWorkflowId,
        REPOSITORY_ROOT: repositoryRoot,
        TASK_BACKEND: "yx",
        DISPATCHER_POLL_INTERVAL_MS: "100",
        DISPATCHER_MAX_CONCURRENT_IMPLEMENTATIONS: "1",
        INFERENCE_ENDPOINT: `http://127.0.0.1:${inferencePort}/v1`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    worker.stdout?.on("data", (chunk) => { workerOutput += chunk.toString(); });
    worker.stderr?.on("data", (chunk) => { workerOutput += chunk.toString(); });
    try {
      await waitFor(async () => {
        try {
          return (await readFile(markerPath, "utf8")) === "worker integration complete\n";
        } catch {
          return false;
        }
      }, 90_000);
    } catch (error) {
      const currentYaks = await yx(["list", "--format", "json"]).catch((yxError) => String(yxError));
      throw new Error(`${error instanceof Error ? error.message : String(error)}\nworker output:\n${workerOutput}\nyx state:\n${currentYaks}`);
    }
    const yaks = JSON.parse(await yx(["list", "--format", "json"])) as Array<{ name: string; state: string; children?: Array<{ name: string; state: string }> }>;
    assert.equal(findYak(yaks, yakName)?.state, "done", workerOutput);
  } finally {
    if (worker && worker.exitCode === null) {
      worker.kill("SIGTERM");
      await new Promise<void>((resolve) => worker?.once("exit", () => resolve()));
    }
    try {
      const temporalConnection = await Connection.connect({ address: temporalAddress });
      try {
        const temporalClient = new Client({ connection: temporalConnection, namespace: temporalNamespace });
        await temporalClient.workflow.getHandle(dispatcherWorkflowId).terminate("integration test cleanup");
      } finally {
        await temporalConnection.close();
      }
    } catch {
      // The dispatcher may not have started if the worker failed during startup.
    }
    await rm(markerPath, { force: true });
    await yx(["remove", yakName]).catch(() => undefined);
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
