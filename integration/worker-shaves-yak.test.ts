import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Connection, Client } from "@temporalio/client";
import test from "node:test";
import { temporalAddressFromEnvironment } from "../dist/temporal-address.js";

const execFileAsync = promisify(execFile);
const repositoryRoot = process.cwd();
const temporalAddress = process.env.INTEGRATION_TEMPORAL_ADDRESS ?? temporalAddressFromEnvironment();
const temporalNamespace = process.env.INTEGRATION_TEMPORAL_NAMESPACE ?? process.env.TEMPORAL_NAMESPACE ?? "inference";

function sse(events: unknown[]): string {
  return `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`;
}

async function yx(args: string[]): Promise<string> {
  const result = await execFileAsync("yx", args, { cwd: repositoryRoot, maxBuffer: 4 * 1024 * 1024 });
  return result.stdout;
}

async function jj(args: string[]): Promise<string> {
  const result = await execFileAsync("jj", args, { cwd: repositoryRoot, maxBuffer: 4 * 1024 * 1024 });
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
        TEMPORAL_ADDRESS: temporalAddress,
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
      const currentYaks = JSON.parse(await yx(["list", "--format", "json"])) as Array<{ name: string; state: string }>;
      return findYak(currentYaks, yakName)?.state === "done";
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
    await yx(["remove", "--recursive", yakName]).catch(() => undefined);
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("devenv worker discards a timed-out workspace and creates bounded failure children", async () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const yakName = `integration slow yak ${suffix}`;
  const independentName = `integration independent yak ${suffix}`;
  const dispatcherWorkflowId = `integration-slow-dispatcher-${suffix}`;
  const pendingTimers = new Set<NodeJS.Timeout>();
  let plannerRequests = 0;
  let slowAgentRequests = 0;
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const parsed = JSON.parse(body) as { messages: Array<{ role: string; content?: string }> };
    const planner = parsed.messages.some((message) => message.content?.includes("strict JSON matching"));
    if (planner) {
      plannerRequests += 1;
      response.writeHead(200, { "content-type": "text/event-stream" });
      const plan = JSON.stringify({ proposals: [
        { name: "Implement first recovery", goal: "Recover the first part.", scope: ["first"], acceptanceCriteria: ["First recovery works."], tests: ["Run first recovery tests."], dependencies: [], nonGoals: ["Do not recover the second part."] },
        { name: "Implement second recovery", goal: "Recover the second part.", scope: ["second"], acceptanceCriteria: ["Second recovery works."], tests: ["Run second recovery tests."], dependencies: [], nonGoals: ["Do not recover the first part."] },
      ] });
      response.end(sse([{ choices: [{ delta: { content: plan } }] }, { choices: [{ finish_reason: "stop", delta: {} }] }]));
      return;
    }
    if (slowAgentRequests++ > 0) {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(sse([{ choices: [{ finish_reason: "stop", delta: {} }] }]));
      return;
    }
    const timer = setTimeout(() => response.end(sse([{ choices: [{ finish_reason: "stop", delta: {} }] }])), 10_000);
    pendingTimers.add(timer);
    response.on("close", () => {
      clearTimeout(timer);
      pendingTimers.delete(timer);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const inferencePort = (server.address() as { port: number }).port;
  let worker: ReturnType<typeof spawn> | undefined;
  let workerOutput = "";
  let parentId: string | undefined;
  const shimDirectory = await mkdtemp(path.join(os.tmpdir(), "inference-worker-yx-shim-"));
  try {
    await yx(["add", yakName, "--state", "todo", "--context", "The agent must exceed the test timeout."]);
    await yx(["tag", "add", yakName, "@g2g", "@priority:999"]);
    await yx(["add", independentName, "--state", "todo", "--context", "Complete independently."]);
    await yx(["tag", "add", independentName, "@g2g", "@priority:1"]);
    const initialYaks = JSON.parse(await yx(["list", "--format", "json"])) as Array<{ id: string; name: string }>;
    parentId = initialYaks.find((yak) => yak.name === yakName)?.id;
    assert.ok(parentId);
    const realYx = (await execFileAsync("which", ["yx"])).stdout.trim();
    const yxShim = path.join(shimDirectory, "yx");
    await writeFile(yxShim, `#!/usr/bin/env node\nimport { spawn } from "node:child_process";\nconst args = process.argv.slice(2);\nfor (let index = args.length - 2; index >= 0; index -= 1) {\n  if (args[index] === "--format" && args[index + 1] === "ids") args.splice(index, 2);\n}\nconst child = spawn(${JSON.stringify(realYx)}, args, { stdio: "inherit" });\nchild.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));\n`);
    await chmod(yxShim, 0o755);
    worker = spawn(process.execPath, [path.join(repositoryRoot, "dist/worker.js")], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        TEMPORAL_ADDRESS: temporalAddress,
        TEMPORAL_NAMESPACE: temporalNamespace,
        TEMPORAL_TASK_QUEUE: `integration-slow-worker-${suffix}`,
        DISPATCHER_WORKFLOW_ID: dispatcherWorkflowId,
        REPOSITORY_ROOT: repositoryRoot,
        TASK_BACKEND: "yx",
        DISPATCHER_POLL_INTERVAL_MS: "100",
        DISPATCHER_MAX_CONCURRENT_IMPLEMENTATIONS: "1",
        AGENT_MAX_RUN_TIME_SECONDS: "1",
        WORK_ITEM_CLEANUP_GRACE_SECONDS: "1",
        DISPATCHER_MAX_SPLIT_CHILDREN: "2",
        DISPATCHER_PLANNER_MAX_RUN_TIME_SECONDS: "5",
        INFERENCE_ENDPOINT: `http://127.0.0.1:${inferencePort}/v1`,
        PATH: `${shimDirectory}:${process.env.PATH ?? ""}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    worker.stdout?.on("data", (chunk) => { workerOutput += chunk.toString(); });
    worker.stderr?.on("data", (chunk) => { workerOutput += chunk.toString(); });
    await waitFor(async () => {
      if (!parentId) return false;
      const yaks = JSON.parse(await yx(["list", "--format", "json"])) as Array<{ id: string; name: string; state: string; tags?: string[]; context?: string; children?: unknown[] }>;
      const parent = findYak(yaks, yakName) as ({ state: string; tags?: string[]; context?: string; children?: unknown[] } | undefined);
      return slowAgentRequests >= 1 && plannerRequests >= 1 && parent?.tags?.includes("@implementation-failed") === true && parent.children?.length === 2;
    }, 30_000);
    await waitFor(async () => findYak(JSON.parse(await yx(["list", "--format", "json"])), independentName)?.state === "done", 30_000);
    const yaks = JSON.parse(await yx(["list", "--format", "json"])) as Array<{ name: string; state: string; tags?: string[]; children?: unknown[] }>;
    const parent = findYak(yaks, yakName) as ({ state: string; tags?: string[]; context?: string; children?: Array<{ name: string; state: string; tags?: string[] }> } | undefined);
    assert.equal(parent?.children?.length, 2);
    assert.equal(parent?.tags?.includes("@implementation-failed"), true);
    assert.equal(findYak(yaks, independentName)?.state, "done");
    assert.equal((await jj(["workspace", "list"])).includes(`inference-${parentId}`), false);
    assert.match(workerOutput, /worker policy/);
  } catch (error) {
    const currentYaks = await yx(["list", "--format", "json"]).catch((yxError) => String(yxError));
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nworker output:\n${workerOutput}\nyx state:\n${currentYaks}`);
  } finally {
    for (const timer of pendingTimers) clearTimeout(timer);
    if (worker && worker.exitCode === null) {
      worker.kill("SIGTERM");
      await new Promise<void>((resolve) => worker?.once("exit", () => resolve()));
    }
    try {
      const temporalConnection = await Connection.connect({ address: temporalAddress });
      try {
        await new Client({ connection: temporalConnection, namespace: temporalNamespace }).workflow.getHandle(dispatcherWorkflowId).terminate("integration test cleanup");
      } finally {
        await temporalConnection.close();
      }
    } catch {
      // The dispatcher may not have started if the worker failed during startup.
    }
    await yx(["remove", yakName]).catch(() => undefined);
    await yx(["remove", independentName]).catch(() => undefined);
    await rm(shimDirectory, { recursive: true, force: true });
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
