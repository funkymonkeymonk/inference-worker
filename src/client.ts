import { Connection, Client } from "@temporalio/client";
import { InferenceWorkflow } from "./workflows/inference.js";
import { TASK_QUEUE, type InferenceRequest } from "./types.js";

const request: InferenceRequest = {
  requestType: "fast",
  messages: [{ role: "user", content: process.argv.slice(2).join(" ") || "Say hello." }],
};
const connection = await Connection.connect({ address: process.env.TEMPORAL_ADDRESS ?? "127.0.0.1:7233" });
const client = new Client({
  connection,
  namespace: process.env.TEMPORAL_NAMESPACE ?? "inference",
});
const result = await client.workflow.execute(InferenceWorkflow, {
  args: [request],
  taskQueue: process.env.TEMPORAL_TASK_QUEUE ?? TASK_QUEUE,
  workflowId: `inference-${Date.now()}`,
});
console.log(JSON.stringify(result));
await connection.close();
