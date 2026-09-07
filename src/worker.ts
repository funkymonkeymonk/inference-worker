import { NativeConnection, Worker } from "@temporalio/worker";
import { Connection, Client, WorkflowExecutionAlreadyStartedError } from "@temporalio/client";
import * as activities from "./activities/index.js";
import { WorkDispatcherWorkflow } from "./workflows/dispatcher.js";
import { temporalAddressFromEnvironment } from "./temporal-address.js";
import { dispatcherWorkflowId } from "./workflow-id.js";
import { shutdownWorker } from "./worker-shutdown.js";
import { configFromEnvironment, dispatcherSplitPolicyFromConfig } from "./config.js";

const address = temporalAddressFromEnvironment();
const namespace = process.env.TEMPORAL_NAMESPACE ?? "inference";
const taskQueue = process.env.TEMPORAL_TASK_QUEUE ?? "inference-worker";
const repositoryRoot = process.env.REPOSITORY_ROOT ?? process.cwd();
const taskBackend = process.env.TASK_BACKEND ?? "yx";
if (taskBackend !== "yx") throw new Error(`unsupported task backend: ${taskBackend}`);
const config = configFromEnvironment();

const connection = await NativeConnection.connect({ address });
const worker = await Worker.create({
  connection,
  namespace,
  taskQueue,
  workflowsPath: new URL("./workflows/index.js", import.meta.url).pathname,
  activities,
  maxConcurrentActivityTaskExecutions: Number(
    process.env.WORKER_ACTIVITY_SLOTS ?? process.env.DISPATCHER_MAX_CONCURRENT_IMPLEMENTATIONS ?? 1,
  ),
});
const clientConnection = await Connection.connect({ address });
const client = new Client({ connection: clientConnection, namespace });
const configuredDispatcherWorkflowId = process.env.DISPATCHER_WORKFLOW_ID;
const workflowId = configuredDispatcherWorkflowId ?? dispatcherWorkflowId(repositoryRoot);
if (process.env.DISPATCHER_ENABLED !== "false") {
  try {
    await client.workflow.start(WorkDispatcherWorkflow, {
      args: [{
        pollIntervalMs: Number(process.env.DISPATCHER_POLL_INTERVAL_MS ?? 60_000),
         maxConcurrentImplementations: Number(process.env.DISPATCHER_MAX_CONCURRENT_IMPLEMENTATIONS ?? 1),
         splitPolicy: dispatcherSplitPolicyFromConfig(config),
       }],
      taskQueue,
      workflowId,
    });
  } catch (error) {
    if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
  }
}

const workerRun = worker.run();
const shutdown = () => shutdownWorker(worker, workerRun, [connection, clientConnection]);
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
await workerRun;
