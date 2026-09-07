import assert from "node:assert/strict";
import test from "node:test";
import { YxUiReader } from "./yx-reader.js";

test("yx UI reader only performs read-only commands", async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const reader = new YxUiReader(async (command, args) => {
    calls.push({ command, args });
    return command === "yx" && args[0] === "list" ? JSON.stringify([{ id: "yak-1", name: "Task", state: "todo" }]) : "context";
  });

  assert.deepEqual(await reader.list(), [{ id: "yak-1", title: "Task", state: "todo" }]);
  assert.equal(await reader.context("yak-1"), "context");
  assert.deepEqual(calls, [
    { command: "yx", args: ["list", "--format", "json"] },
    { command: "yx", args: ["context", "yak-1", "--show"] },
  ]);
});
