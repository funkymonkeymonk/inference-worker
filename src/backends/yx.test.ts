import assert from "node:assert/strict";
import test from "node:test";
import { YxTaskBackend, type YxCommandRunner, type YxYak } from "./yx.js";

const yaks: YxYak[] = [
  { id: "new-low", name: "new low", state: "todo", tags: ["@g2g", "@priority:2"], createdAt: "2026-01-02T00:00:00Z", context: "new work" },
  { id: "review-high", name: "review high", state: "todo", tags: ["@g2g", "@priority:1"], createdAt: "2026-01-03T00:00:00Z", context: "PR has actionable CHANGES_REQUESTED feedback" },
  { id: "new-high", name: "new high", state: "todo", tags: ["@g2g", "@priority:9"], createdAt: "2026-01-01T00:00:00Z", context: "new work" },
  { id: "bad-priority", name: "bad priority", state: "todo", tags: ["@g2g", "@priority:urgent"], context: "skip me" },
  { id: "not-ready", name: "not ready", state: "wip", tags: ["@g2g", "@priority:100"], context: "skip me" },
];

function backend(runner: YxCommandRunner = async () => JSON.stringify(yaks)): YxTaskBackend {
  return new YxTaskBackend({ repositoryRoot: "/workspace/project", policy: { model: "test-model", allowedTools: ["read"], maxRunTimeSeconds: 60 }, runner });
}

test("orders review candidates before implementation candidates", async () => {
  const candidates = await backend().listDispatchCandidates({ excludeIds: [], limit: 10 });
  assert.deepEqual(candidates.map((candidate) => candidate.id), ["review-high", "new-high", "new-low"]);
  assert.equal(candidates[0].kind, "review");
});

test("skips malformed priorities, non-todo yaks, exclusions, and applies limit", async () => {
  const candidates = await backend().listDispatchCandidates({ excludeIds: ["review-high"], limit: 1 });
  assert.deepEqual(candidates.map((candidate) => candidate.id), ["new-high"]);
});

test("maps lifecycle operations to yx commands", async () => {
  const calls: string[][] = [];
  const runner: YxCommandRunner = async (_command, args) => {
    calls.push(args);
    return args[0] === "context" ? "context text" : "[]";
  };
  const taskBackend = backend(runner);
  await taskBackend.claim("yak-1");
  await taskBackend.release("yak-1", "agent failed");
  await taskBackend.markDone("yak-1");
  assert.equal(await taskBackend.getContext("yak-1"), "context text");
  await taskBackend.attachPullRequest("yak-1", "https://github.com/example/pull/1");
  assert.deepEqual(calls, [
    ["start", "yak-1"],
    ["state", "yak-1", "todo"],
    ["done", "yak-1"],
    ["context", "yak-1", "--show"],
    ["field", "yak-1", "pull-request-url"],
  ]);
});
