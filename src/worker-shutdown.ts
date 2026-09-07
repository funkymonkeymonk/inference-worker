export interface ShutdownWorker {
  shutdown(): void;
}

export interface CloseableConnection {
  close(): Promise<void>;
}

export async function shutdownWorker(
  worker: ShutdownWorker,
  workerRun: Promise<void>,
  connections: CloseableConnection[],
): Promise<void> {
  worker.shutdown();
  await workerRun;
  await Promise.all(connections.map((connection) => connection.close()));
}
