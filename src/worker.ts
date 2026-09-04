import { NativeConnection, Worker } from "@temporalio/worker";
import * as activities from "./activities/index.js";

const address = process.env.TEMPORAL_ADDRESS ?? "127.0.0.1:7233";
const namespace = process.env.TEMPORAL_NAMESPACE ?? "inference";
const taskQueue = process.env.TEMPORAL_TASK_QUEUE ?? "inference-worker";

const connection = await NativeConnection.connect({ address });
const worker = await Worker.create({
  connection,
  namespace,
  taskQueue,
  workflowsPath: new URL("./workflows/inference.js", import.meta.url).pathname,
  activities,
  maxConcurrentActivityTaskExecutions: Number(process.env.WORKER_ACTIVITY_SLOTS ?? 1),
});

const shutdown = async () => {
  await worker.shutdown();
  await connection.close();
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
await worker.run();
