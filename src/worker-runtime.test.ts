import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { InferenceWorkflow } from "./workflows/inference.js";
import { WorkItemWorkflow } from "./workflows/work-item.js";
import { WorkDispatcherWorkflow } from "./workflows/dispatcher.js";
import * as activities from "./activities/index.js";
import { workerRegistrations, workerRuntimeFromEnvironment } from "./worker-runtime.js";

function runtime(env: Record<string, string>) {
  return workerRuntimeFromEnvironment({
    TEMPORAL_ADDRESS: "127.0.0.1:7233",
    TEMPORAL_NAMESPACE: "inference",
    TEMPORAL_TASK_QUEUE: "inference-worker",
    REPOSITORY_ROOT: "/repo/project",
    TASK_BACKEND: "yx",
    INFERENCE_ENDPOINT: "http://127.0.0.1:8081/v1",
    ...env,
  } as NodeJS.ProcessEnv);
}

function pathLike(env: Record<string, string>): NodeJS.ProcessEnv {
  return { ...env, PATH: "/bin" } as NodeJS.ProcessEnv;
}

const ACTIVITY_NAMES = [
  "executeInference",
  "executePiTask",
  "executeAgent",
  "planYakSplit",
  "createWorkspace",
  "cleanupWorkspace",
  "listDispatchCandidates",
  "claimTask",
  "releaseTask",
  "recordTaskFailure",
  "splitTask",
  "markTaskDone",
];

test("returns a validated runtime configuration from environment", () => {
  const config = workerRuntimeFromEnvironment(pathLike({
    TEMPORAL_PORT: "7234",
    TEMPORAL_NAMESPACE: "inference",
    TEMPORAL_TASK_QUEUE: "inference-worker",
    REPOSITORY_ROOT: "/repo/project",
    TASK_BACKEND: "yx",
    INFERENCE_ENDPOINT: "http://127.0.0.1:8081/v1",
  }));

  assert.equal(config.address, "127.0.0.1:7234");
  assert.equal(config.namespace, "inference");
  assert.equal(config.taskQueue, "inference-worker");
  assert.equal(config.repositoryRoot, "/repo/project");
  assert.equal(config.taskBackend, "yx");
  assert.equal(config.inferenceEndpoint, "http://127.0.0.1:8081/v1");
  assert.equal(config.inferenceApiKey, undefined);
  assert.equal(config.githubToken, undefined);
  assert.equal(config.dispatcherWorkflowId, "dispatcher-/repo/project");
  assert.equal(config.maxConcurrentImplementations, 1);
  assert.equal(config.maxConcurrentActivityTaskExecutions, 1);
  assert.equal(config.policy.model, "omlx/qwen3.8-27b");
});

test("honors explicit address, queue, and capacity overrides", () => {
  const config = workerRuntimeFromEnvironment(pathLike({
    TEMPORAL_ADDRESS: "temporal.example:7233",
    TEMPORAL_NAMESPACE: "custom",
    TEMPORAL_TASK_QUEUE: "other-queue",
    REPOSITORY_ROOT: "/repo/project",
    TASK_BACKEND: "yx",
    INFERENCE_ENDPOINT: "http://127.0.0.1:8081/v1",
    WORKER_ACTIVITY_SLOTS: "3",
    DISPATCHER_POLL_INTERVAL_MS: "1000",
  }));

  assert.equal(config.address, "temporal.example:7233");
  assert.equal(config.namespace, "custom");
  assert.equal(config.taskQueue, "other-queue");
  assert.equal(config.maxConcurrentActivityTaskExecutions, 3);
  assert.equal(config.maxConcurrentImplementations, 1);
  assert.equal(config.pollIntervalMs, 1000);
});

test("passes optional credentials through to the runtime configuration", () => {
  const config = runtime({ INFERENCE_API_KEY: "secret-key", GITHUB_TOKEN: "gh-token" });
  assert.equal(config.inferenceApiKey, "secret-key");
  assert.equal(config.githubToken, "gh-token");
});

test("registers all three workflows and their Activities on the configured task queue", () => {
  const registration = workerRegistrations();

  assert.deepEqual(
    registration.workflows,
    [InferenceWorkflow, WorkItemWorkflow, WorkDispatcherWorkflow],
  );
  for (const name of ACTIVITY_NAMES) {
    assert.equal(typeof registration.activities[name], "function", `missing Activity ${name}`);
  }
});

test("rejects a missing inference endpoint with an actionable error", () => {
  assert.throws(
    () => workerRuntimeFromEnvironment(pathLike({
      TEMPORAL_ADDRESS: "127.0.0.1:7233",
      TEMPORAL_NAMESPACE: "inference",
      TEMPORAL_TASK_QUEUE: "inference-worker",
      REPOSITORY_ROOT: "/repo/project",
      TASK_BACKEND: "yx",
    })),
    (error: unknown) => error instanceof Error && /INFERENCE_ENDPOINT/.test(error.message),
  );
});

test("rejects an empty repository root with an actionable error", () => {
  assert.throws(
    () => workerRuntimeFromEnvironment(pathLike({
      TEMPORAL_ADDRESS: "127.0.0.1:7233",
      TEMPORAL_NAMESPACE: "inference",
      TEMPORAL_TASK_QUEUE: "inference-worker",
      REPOSITORY_ROOT: "   ",
      TASK_BACKEND: "yx",
      INFERENCE_ENDPOINT: "http://127.0.0.1:8081/v1",
    })),
    (error: unknown) => error instanceof Error && /REPOSITORY_ROOT/.test(error.message),
  );
});

test("rejects an unsupported task backend with an actionable error", () => {
  assert.throws(
    () => workerRuntimeFromEnvironment(pathLike({
      TEMPORAL_ADDRESS: "127.0.0.1:7233",
      TEMPORAL_NAMESPACE: "inference",
      TEMPORAL_TASK_QUEUE: "inference-worker",
      REPOSITORY_ROOT: "/repo/project",
      TASK_BACKEND: "jira",
      INFERENCE_ENDPOINT: "http://127.0.0.1:8081/v1",
    })),
    (error: unknown) => error instanceof Error && /unsupported task backend: jira/.test(error.message),
  );
});

test("rejects an empty Temporal task queue with an actionable error", () => {
  assert.throws(
    () => workerRuntimeFromEnvironment(pathLike({
      TEMPORAL_ADDRESS: "127.0.0.1:7233",
      TEMPORAL_NAMESPACE: "inference",
      TEMPORAL_TASK_QUEUE: "",
      REPOSITORY_ROOT: "/repo/project",
      TASK_BACKEND: "yx",
      INFERENCE_ENDPOINT: "http://127.0.0.1:8081/v1",
    })),
    (error: unknown) => error instanceof Error && /TEMPORAL_TASK_QUEUE/.test(error.message),
  );
});

test("rejects an empty Temporal namespace with an actionable error", () => {
  assert.throws(
    () => workerRuntimeFromEnvironment(pathLike({
      TEMPORAL_ADDRESS: "127.0.0.1:7233",
      TEMPORAL_NAMESPACE: "",
      TEMPORAL_TASK_QUEUE: "inference-worker",
      REPOSITORY_ROOT: "/repo/project",
      TASK_BACKEND: "yx",
      INFERENCE_ENDPOINT: "http://127.0.0.1:8081/v1",
    })),
    (error: unknown) => error instanceof Error && /TEMPORAL_NAMESPACE/.test(error.message),
  );
});

test("falls back to the port when no Temporal address is configured", () => {
  assert.equal(
    workerRuntimeFromEnvironment(pathLike({
      TEMPORAL_PORT: "7234",
      TEMPORAL_NAMESPACE: "inference",
      TEMPORAL_TASK_QUEUE: "inference-worker",
      REPOSITORY_ROOT: "/repo/project",
      TASK_BACKEND: "yx",
      INFERENCE_ENDPOINT: "http://127.0.0.1:8081/v1",
    })).address,
    "127.0.0.1:7234",
  );
});

test("keeps the stable repository-specific dispatcher workflow ID", () => {
  assert.equal(
    runtime({ DISPATCHER_WORKFLOW_ID: "override-id" }).dispatcherWorkflowId,
    "override-id",
  );
});

test("applies the activity slot capacity fallback", () => {
  const config = workerRuntimeFromEnvironment(pathLike({
    TEMPORAL_ADDRESS: "127.0.0.1:7233",
    TEMPORAL_NAMESPACE: "inference",
    TEMPORAL_TASK_QUEUE: "inference-worker",
    REPOSITORY_ROOT: "/repo/project",
    TASK_BACKEND: "yx",
    INFERENCE_ENDPOINT: "http://127.0.0.1:8081/v1",
    DISPATCHER_MAX_CONCURRENT_IMPLEMENTATIONS: "2",
  }));
  assert.equal(config.maxConcurrentActivityTaskExecutions, 2);
});

test("fails fast during startup when the inference endpoint is missing", async (t) => {
  const built = path.resolve(process.cwd(), "dist");
  const sandbox = await mkdtemp(path.join(os.tmpdir(), "worker-runtime-smoke-"));
  t.after(async () => {
    await rm(sandbox, { recursive: true, force: true }).catch(() => undefined);
  });
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    TEMPORAL_ADDRESS: "127.0.0.1:7233",
    TEMPORAL_NAMESPACE: "inference",
    TEMPORAL_TASK_QUEUE: "inference-worker",
    REPOSITORY_ROOT: sandbox,
    YX_ROOT: sandbox,
    TASK_BACKEND: "yx",
  };
  delete childEnv.INFERENCE_ENDPOINT;
  delete childEnv.INFERENCE_API_KEY;
  delete childEnv.GITHUB_TOKEN;
  const child = spawn(process.execPath, [path.join(built, "worker.js")], {
    cwd: sandbox,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.on("data", (chunk) => { output += String(chunk); });
  child.stderr?.on("data", (chunk) => { output += String(chunk); });
  const exitCode = await new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => { child.kill("SIGKILL"); }, 30_000);
    child.on("exit", (code) => { clearTimeout(timer); resolve(code); });
  });
  assert.notEqual(exitCode, 0);
  assert.match(output, /INFERENCE_ENDPOINT/);
});
