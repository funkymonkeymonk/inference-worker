import { Connection, Client } from "@temporalio/client";
import { randomUUID } from "node:crypto";
import { WorkDispatcherWorkflow } from "./workflows/dispatcher.js";
import { TASK_QUEUE, type DispatcherInput } from "./types.js";
import { temporalAddressFromEnvironment } from "./temporal-address.js";

export function dispatcherInputFromEnvironment(environment: NodeJS.ProcessEnv = process.env): DispatcherInput {
  return {
    maxConcurrentImplementations: 1,
    pollIntervalMs: Number(environment.DISPATCHER_POLL_INTERVAL_MS ?? 60_000),
    runOnce: true,
  };
}

export async function runManualDispatch(): Promise<void> {
  const address = temporalAddressFromEnvironment();
  const namespace = process.env.TEMPORAL_NAMESPACE ?? "inference";
  const connection = await Connection.connect({ address });
  try {
    const client = new Client({ connection, namespace });
    const result = await client.workflow.execute(WorkDispatcherWorkflow, {
      args: [dispatcherInputFromEnvironment()],
      taskQueue: process.env.TEMPORAL_TASK_QUEUE ?? TASK_QUEUE,
      workflowId: `manual-dispatch-${randomUUID()}`,
    });
    console.log(JSON.stringify(result));
  } finally {
    await connection.close();
  }
}

if (process.argv[1]?.endsWith("/dispatch.js")) await runManualDispatch();
