import assert from "node:assert/strict";
import test from "node:test";
import { dispatchExclusions } from "./dispatcher.js";

test("excludes active and failed tasks from the next dispatch scan", () => {
  assert.deepEqual(
    dispatchExclusions({ activeTaskIds: ["active"], completedTaskIds: ["done"], failedTaskIds: ["failed"] }),
    ["active", "failed"],
  );
});
