import assert from "node:assert/strict";
import test from "node:test";
import { shutdownWorker } from "./worker-shutdown.js";

test("waits for the worker to stop before closing Temporal connections", async () => {
  let resolveWorker: (() => void) | undefined;
  let workerStopped = false;
  let connectionClosed = false;
  const workerRun = new Promise<void>((resolve) => { resolveWorker = resolve; });
  const shutdown = shutdownWorker(
    { shutdown: () => undefined },
    workerRun,
    [{ close: async () => { assert.equal(workerStopped, true); connectionClosed = true; } }],
  );

  await Promise.resolve();
  assert.equal(connectionClosed, false);
  workerStopped = true;
  resolveWorker!();
  await shutdown;
  assert.equal(connectionClosed, true);
});
