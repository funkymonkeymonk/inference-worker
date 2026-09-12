import { NativeConnection, Worker } from "@temporalio/worker";
import { Client, Connection, WorkflowExecutionAlreadyStartedError } from "@temporalio/client";
import * as activities from "./activities/index.js";
import { InferenceWorkflow } from "./workflows/inference.js";
import { WorkItemWorkflow } from "./workflows/work-item.js";
import { WorkDispatcherWorkflow } from "./workflows/dispatcher.js";
import { temporalAddressFromEnvironment } from "./temporal-address.js";
import { dispatcherWorkflowId } from "./workflow-id.js";
import { shutdownWorker } from "./worker-shutdown.js";
import { configFromEnvironment, dispatcherSplitPolicyFromConfig, formatWorkerPolicyDiagnostics } from "./config.js";
import type { AgentToolName, WorkerRegistration, WorkerRuntimeConfig } from "./types.js";

const ALLOWED_TOOLS: AgentToolName[] = ["read", "write", "edit", "bash", "listToolFiles"];

function required(environment: NodeJS.ProcessEnv, key: string, fallback: string): string {
  const value = environment[key] ?? fallback;
  if (!value.trim()) throw new Error(`${key} must not be empty`);
  return value;
}

function optional(environment: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = environment[key];
  if (value === undefined || value.trim() === "") return undefined;
  return value;
}

function positiveInteger(environment: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const value = environment[key];
  if (value === undefined) return fallback;
  if (value.trim() === "") throw new Error(`${key} must be a positive safe integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${key} must be a positive safe integer`);
  return parsed;
}

export function workerRuntimeFromEnvironment(environment: NodeJS.ProcessEnv = process.env): WorkerRuntimeConfig {
  const config = configFromEnvironment(environment);
  const address = temporalAddressFromEnvironment(environment);
  if (!address.trim()) throw new Error("TEMPORAL_ADDRESS must not be empty");
  const taskQueue = required(environment, "TEMPORAL_TASK_QUEUE", "inference-worker");
  const taskBackend = required(environment, "TASK_BACKEND", "yx");
  if (taskBackend !== "yx") throw new Error(`unsupported task backend: ${taskBackend}`);
  const inferenceEndpoint = required(environment, "INFERENCE_ENDPOINT", "");
  const repositoryRoot = required(environment, "REPOSITORY_ROOT", process.cwd());
  return {
    address,
    namespace: required(environment, "TEMPORAL_NAMESPACE", "inference"),
    taskQueue,
    repositoryRoot,
    taskBackend,
    inferenceEndpoint,
    inferenceApiKey: optional(environment, "INFERENCE_API_KEY"),
    githubToken: optional(environment, "GITHUB_TOKEN"),
    dispatcherWorkflowId: optional(environment, "DISPATCHER_WORKFLOW_ID") ?? dispatcherWorkflowId(repositoryRoot),
    pollIntervalMs: positiveInteger(environment, "DISPATCHER_POLL_INTERVAL_MS", 60_000),
    maxConcurrentImplementations: positiveInteger(environment, "DISPATCHER_MAX_CONCURRENT_IMPLEMENTATIONS", 1),
    maxConcurrentActivityTaskExecutions: positiveInteger(
      environment,
      "WORKER_ACTIVITY_SLOTS",
      positiveInteger(environment, "DISPATCHER_MAX_CONCURRENT_IMPLEMENTATIONS", 1),
    ),
    policy: {
      model: config.agent.model,
      allowedTools: ALLOWED_TOOLS,
      maxRunTimeSeconds: config.agent.maxRunTimeSeconds,
      cleanupGraceSeconds: config.agent.cleanupGraceSeconds,
      bashTimeoutMs: config.agent.bashTimeoutMs,
      maxOutputTokens: config.agent.maxOutputTokens,
    },
  };
}

export function workerRegistrations(): WorkerRegistration {
  return {
    workflows: [InferenceWorkflow, WorkItemWorkflow, WorkDispatcherWorkflow],
    activities,
  };
}

export async function runWorker(environment: NodeJS.ProcessEnv = process.env): Promise<Promise<void>> {
  const runtime = workerRuntimeFromEnvironment(environment);
  console.info(formatWorkerPolicyDiagnostics(configFromEnvironment(environment)));
  const registrations = workerRegistrations();
  const connection = await NativeConnection.connect({ address: runtime.address });
  const clientConnection = await Connection.connect({ address: runtime.address });
  const client = new Client({ connection: clientConnection, namespace: runtime.namespace });
  const worker = await Worker.create({
    connection,
    namespace: runtime.namespace,
    taskQueue: runtime.taskQueue,
    workflowsPath: new URL("./workflows/index.js", import.meta.url).pathname,
    activities: registrations.activities,
    maxConcurrentActivityTaskExecutions: runtime.maxConcurrentActivityTaskExecutions,
  });
  if (process.env.DISPATCHER_ENABLED !== "false") {
    try {
      await client.workflow.start(WorkDispatcherWorkflow, {
        args: [{
          pollIntervalMs: runtime.pollIntervalMs,
          maxConcurrentImplementations: runtime.maxConcurrentImplementations,
          splitPolicy: dispatcherSplitPolicyFromConfig(configFromEnvironment(environment)),
        }],
        taskQueue: runtime.taskQueue,
        workflowId: runtime.dispatcherWorkflowId,
      });
    } catch (error) {
      if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
    }
  }
  const workerRun = worker.run();
  const shutdown = () => shutdownWorker(worker, workerRun, [connection, clientConnection]);
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  return workerRun;
}
