import assert from "node:assert/strict";
import test from "node:test";
import { YxTaskBackend, type YxCommandRunner, type YxYak } from "./yx.js";
import type { SplitTaskInput } from "../types.js";

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

const splitInput: SplitTaskInput = {
  taskId: "failed-child",
  failureReason: "agent timed out",
  plan: {
    proposals: [
      { name: "Add first child", goal: "Complete the first part.", scope: ["src/one.ts"], acceptanceCriteria: ["First part works."], tests: ["Run first tests."], dependencies: [], nonGoals: ["Do not do the second part."] },
      { name: "Add second child", goal: "Complete the second part.", scope: ["src/two.ts"], acceptanceCriteria: ["Second part works."], tests: ["Run second tests."], dependencies: [], nonGoals: ["Do not do the first part."] },
    ],
  },
};

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

test("rejects a split that exceeds configured depth or child count before mutation", async () => {
  const calls: string[][] = [];
  const taskBackend = new YxTaskBackend({
    repositoryRoot: "/workspace/project",
    policy: { model: "test-model", allowedTools: ["read"], maxRunTimeSeconds: 60 },
    maxYakDepth: 1,
    maxSplitChildren: 1,
    runner: async (_command, args) => {
      calls.push(args);
      return JSON.stringify([{ id: "root", name: "root", state: "wip", children: [{ id: "failed-child", name: "failed", state: "todo" }] }]);
    },
  });
  await assert.rejects(() => taskBackend.splitTask(splitInput), /child count|depth/i);
  assert.deepEqual(calls, [["list", "--format", "json"]]);
});

test("records failure history, blocks the parent, and creates tagged child yaks", async () => {
  const calls: Array<{ args: string[]; input?: string }> = [];
  let addCount = 0;
  const taskBackend = new YxTaskBackend({
    repositoryRoot: "/workspace/project",
    policy: { model: "test-model", allowedTools: ["read"], maxRunTimeSeconds: 60 },
    runner: async (_command, args, input) => {
      calls.push({ args, input });
      if (args[0] === "list") return JSON.stringify([{ id: "root", name: "root", state: "wip", children: [{ id: "failed-child", name: "failed", state: "todo" }] }]);
      if (args[0] === "context" && args[2] === "--show") return "existing context";
      if (args[0] === "add") return `failed-child-split-${++addCount}`;
      return "";
    },
  });

  await taskBackend.splitTask(splitInput);

  assert.deepEqual(calls.map(({ args }) => args), [
    ["list", "--format", "json"],
    ["context", "failed-child", "--show"],
    ["context", "failed-child"],
    ["tag", "add", "failed-child", "@implementation-failed"],
    ["state", "failed-child", "todo"],
    ["add", "Add first child", "--under", "failed-child", "--id", "failed-child-split-1", "--format", "ids"],
    ["tag", "add", "failed-child-split-1", "@implementation-split"],
    ["context", "failed-child-split-1"],
    ["add", "Add second child", "--under", "failed-child", "--id", "failed-child-split-2", "--format", "ids"],
    ["tag", "add", "failed-child-split-2", "@implementation-split"],
    ["context", "failed-child-split-2"],
    ["context", "failed-child", "--show"],
    ["context", "failed-child"],
  ]);
  assert.match(calls[2].input ?? "", /Implementation attempt/);
  assert.match(calls.at(-1)?.input ?? "", /Automatic split/);
  assert.match(calls.at(-1)?.input ?? "", /failed-child-split-1/);
});

test("does not duplicate children when the parent already has a split marker", async () => {
  const calls: string[][] = [];
  const taskBackend = new YxTaskBackend({
    repositoryRoot: "/workspace/project",
    policy: { model: "test-model", allowedTools: ["read"], maxRunTimeSeconds: 60 },
    runner: async (_command, args) => {
      calls.push(args);
      if (args[0] === "list") return JSON.stringify([{ id: "root", name: "root", state: "wip", children: [{ id: "failed-child", name: "failed", state: "todo" }] }]);
      if (args[0] === "context" && args[2] === "--show") return "existing\n\n<!-- inference-worker automatic split -->";
      return "unexpected";
    },
  });

  await taskBackend.splitTask(splitInput);
  assert.deepEqual(calls, [["list", "--format", "json"], ["context", "failed-child", "--show"]]);
});

test("allows marked generated children but blocks their failed descendants", async () => {
  const data: YxYak[] = [{
    id: "root",
    name: "root",
    state: "wip",
    tags: ["@g2g", "@priority:1"],
    children: [{
      id: "failed-parent",
      name: "failed parent",
      state: "todo",
      tags: ["@implementation-failed"],
      children: [
        { id: "generated", name: "generated", state: "todo", tags: ["@implementation-split"] },
        { id: "failed-generated", name: "failed generated", state: "todo", tags: ["@implementation-split", "@implementation-failed"], children: [{ id: "blocked", name: "blocked", state: "todo" }] },
      ],
    }],
  }];
  const candidates = await backend(async () => JSON.stringify(data)).listDispatchCandidates({ excludeIds: [], limit: 10 });
  assert.deepEqual(candidates.map((candidate) => candidate.id), ["generated"]);
});

test("reuses a child created before a later mutation failure", async () => {
  const parent: YxYak = { id: "failed-parent", name: "failed parent", state: "todo", context: "original", children: [] };
  const root: YxYak = { id: "root", name: "root", state: "wip", tags: ["@g2g", "@priority:1"], children: [parent] };
  let parentContext = "original";
  let failSecondAdd = true;
  let addCalls = 0;
  const childContexts = new Map<string, string>();
  const runner: YxCommandRunner = async (_command, args, input) => {
    if (args[0] === "list") return JSON.stringify([root]);
    if (args[0] === "context" && args[2] === "--show") return args[1] === parent.id ? parentContext : childContexts.get(args[1]) ?? "";
    if (args[0] === "context") {
      if (args[1] === parent.id) parentContext = input ?? "";
      else childContexts.set(args[1], input ?? "");
      return "";
    }
    if (args[0] === "tag" && args[1] === "add") {
      const yak = args[2] === parent.id ? parent : parent.children?.find((child) => child.id === args[2]);
      if (yak) yak.tags = [...(yak.tags ?? []), args[3]];
      return "";
    }
    if (args[0] === "add") {
      addCalls += 1;
      if (failSecondAdd && addCalls === 2) {
        failSecondAdd = false;
        throw new Error("simulated child creation failure");
      }
      const child = { id: args[5], name: args[1], state: "todo", tags: [], context: "" };
      parent.children?.push(child);
      return child.id;
    }
    return "";
  };
  const taskBackend = new YxTaskBackend({
    repositoryRoot: "/workspace/project",
    policy: { model: "test-model", allowedTools: ["read"], maxRunTimeSeconds: 60 },
    runner,
  });

  await assert.rejects(() => taskBackend.splitTask({ ...splitInput, taskId: parent.id }), /simulated child creation failure/);
  await taskBackend.splitTask({ ...splitInput, taskId: parent.id });

  assert.equal(addCalls, 3);
  assert.deepEqual(parent.children?.map((child) => child.id), ["failed-parent-split-1", "failed-parent-split-2"]);
  assert.match(parentContext, /inference-worker automatic split/);
});
