import assert from "node:assert/strict";
import test from "node:test";
import { YxTaskBackend, type YxCommandRunner, type YxYak } from "./yx.js";

const yaks: YxYak[] = [
  {
    id: "root-low",
    name: "root low",
    state: "wip",
    tags: ["@g2g", "@priority:2"],
    children: [{ id: "low-child", name: "low child", state: "todo", context: "new work" }],
  },
  {
    id: "root-high",
    name: "root high",
    state: "wip",
    tags: ["@g2g", "@priority:9"],
    children: [{
      id: "high-child",
      name: "high child",
      state: "todo",
      context: "new work",
      tags: ["@implementation-failed"],
      children: [{ id: "high-grandchild", name: "high grandchild", state: "todo", context: "new work" }],
    }],
  },
  {
    id: "root-review",
    name: "root review",
    state: "todo",
    tags: ["@g2g", "@priority:5"],
    context: "final documentation and quality review",
    children: [{ id: "review-child", name: "review child", state: "done" }],
  },
  {
    id: "root-blocked-review",
    name: "root blocked review",
    state: "todo",
    tags: ["@g2g", "@priority:8"],
    context: "final documentation and quality review",
    children: [{ id: "unfinished-child", name: "unfinished child", state: "wip" }],
  },
  {
    id: "root-no-priority",
    name: "root no priority",
    state: "wip",
    tags: ["@g2g"],
    children: [{ id: "child-no-priority", name: "child no priority", state: "todo" }],
  },
];

function backend(runner: YxCommandRunner = async () => JSON.stringify(yaks)): YxTaskBackend {
  return new YxTaskBackend({ repositoryRoot: "/workspace/project", policy: { model: "test-model", allowedTools: ["read"], maxRunTimeSeconds: 60 }, runner });
}

test("inherits root metadata and orders candidates by root priority then depth", async () => {
  const candidates = await backend().listDispatchCandidates({ excludeIds: [], limit: 10 });
  assert.deepEqual(candidates.map((candidate) => candidate.id), ["root-review", "low-child"]);
  assert.equal(candidates[0].kind, "review");
});

test("does not dispatch a root review until every child is terminal", async () => {
  const candidates = await backend().listDispatchCandidates({ excludeIds: [], limit: 10 });
  assert.equal(candidates.some((candidate) => candidate.id === "root-blocked-review"), false);
});

test("skips roots without valid metadata, exclusions, and applies limit", async () => {
  const candidates = await backend().listDispatchCandidates({ excludeIds: ["high-grandchild"], limit: 1 });
  assert.deepEqual(candidates.map((candidate) => candidate.id), ["root-review"]);
});

test("skips failed implementations and their descendants while keeping independent work eligible", async () => {
  const candidates = await backend().listDispatchCandidates({ excludeIds: [], limit: 10 });
  assert.deepEqual(candidates.map((candidate) => candidate.id), ["root-review", "low-child"]);
});

test("maps lifecycle operations to yx commands", async () => {
  const calls: string[][] = [];
  const inputs: string[] = [];
  const runner: YxCommandRunner = async (_command, args, input) => {
    calls.push(args);
    if (input !== undefined) inputs.push(input);
    return args[0] === "context" ? "context text" : "[]";
  };
  const taskBackend = backend(runner);
  await taskBackend.claim("yak-1");
  await taskBackend.release("yak-1", "agent failed");
  await taskBackend.markDone("yak-1");
  await taskBackend.recordFailure("yak-1", "agent failed");
  assert.equal(await taskBackend.getContext("yak-1"), "context text");
  await taskBackend.attachPullRequest("yak-1", "https://github.com/example/pull/1");
  assert.deepEqual(calls, [
    ["start", "yak-1"],
    ["state", "yak-1", "todo"],
    ["done", "yak-1"],
    ["context", "yak-1", "--show"],
    ["context", "yak-1"],
    ["tag", "add", "yak-1", "@implementation-failed"],
    ["state", "yak-1", "todo"],
    ["context", "yak-1", "--show"],
    ["field", "yak-1", "pull-request-url"],
  ]);
  assert.match(inputs[0], /Implementation attempt/);
  assert.match(inputs[0], /agent failed/);
});
