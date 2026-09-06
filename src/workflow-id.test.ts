import assert from "node:assert/strict";
import test from "node:test";
import { dispatcherWorkflowId } from "./workflow-id.js";

test("keeps repository paths unencoded in dispatcher workflow IDs", () => {
  assert.equal(
    dispatcherWorkflowId("/Users/monkey/src/funkymonkeymonk/inference-worker"),
    "dispatcher-/Users/monkey/src/funkymonkeymonk/inference-worker",
  );
});
