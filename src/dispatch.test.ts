import assert from "node:assert/strict";
import test from "node:test";
import { dispatcherInputFromEnvironment } from "./dispatch.js";

test("manual dispatch runs one reconciliation with one implementation slot", () => {
  assert.deepEqual(
    dispatcherInputFromEnvironment({
      DISPATCHER_MAX_CONCURRENT_IMPLEMENTATIONS: "3",
      DISPATCHER_POLL_INTERVAL_MS: "1500",
    }),
    {
      maxConcurrentImplementations: 1,
      pollIntervalMs: 1500,
      runOnce: true,
      splitPolicy: {
        enabled: true,
        maxRootDepth: 10,
        maxChildren: 5,
        planner: { model: "omlx/qwen3.8-27b", maxRunTimeSeconds: 600, maxOutputTokens: 4096 },
      },
    },
  );
});
