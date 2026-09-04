import assert from "node:assert/strict";
import test from "node:test";
import { buildPiPrompt } from "./execute-pi.js";

test("builds a task-scoped Pi prompt", () => {
  assert.equal(buildPiPrompt("inspect the repository"), "inspect the repository\n\nComplete this task and report what changed.");
});
