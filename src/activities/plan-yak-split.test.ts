import assert from "node:assert/strict";
import test from "node:test";
import { runPlanner, type PlannerFetch } from "./plan-yak-split.js";
import type { PlanYakSplitInput } from "../types.js";

function streamResponse(events: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(`data: ${event}\n\n`));
      controller.close();
    },
  });
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

function rawStreamResponse(content: string, close = true, onCancel?: () => void): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(content));
      if (close) controller.close();
    },
    cancel: onCancel,
  });
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

const proposal = {
  name: "Add planner contracts",
  goal: "Define the planner output contract.",
  scope: ["src/types.ts"],
  acceptanceCriteria: ["The contract is serializable."],
  tests: ["Run the contract tests."],
  dependencies: [],
  nonGoals: ["Do not create yaks."],
};

function input(overrides: Partial<PlanYakSplitInput> = {}): PlanYakSplitInput {
  return {
    title: "Implement planner Activity",
    context: "The failed yak was implementing planner contracts.",
    failureReason: "The implementation agent timed out.",
    currentRootDepth: 2,
    maxRootDepth: 10,
    maxChildren: 5,
    policy: { model: "planner-model", maxRunTimeSeconds: 10, maxOutputTokens: 4096 },
    ...overrides,
  };
}

function responseFor(value: unknown): Response {
  return streamResponse([
    JSON.stringify({ choices: [{ delta: { content: JSON.stringify(value) } }] }),
    JSON.stringify({ choices: [{ finish_reason: "stop", delta: {} }] }),
    "[DONE]",
  ]);
}

test("parses a valid planner response and sends no tools", async () => {
  let request: { model: string; messages: Array<{ content: string }>; tools?: unknown; max_tokens: number } | undefined;
  const fetchImpl: PlannerFetch = async (_url, init) => {
    request = JSON.parse(String(init?.body));
    return responseFor({ proposals: [proposal, { ...proposal, name: "Write planner tests" }] });
  };

  const result = await runPlanner(input(), { fetchImpl, endpoint: "http://test.invalid/v1" });

  assert.deepEqual(result.proposals[0], proposal);
  assert.equal(request?.model, "planner-model");
  assert.equal(request?.max_tokens, 4096);
  assert.equal("tools" in (request ?? {}), false);
  assert.match(request?.messages[1].content ?? "", /Implement planner Activity/);
  assert.match(request?.messages[1].content ?? "", /timed out/);
  assert.match(request?.messages[1].content ?? "", /currentRootDepth/);
  assert.doesNotMatch(request?.messages[1].content ?? "", /repository|workspace|bash|write tool/i);
});

test("rejects malformed and empty planner output", async () => {
  for (const value of ["not json", { proposals: [] }]) {
    await assert.rejects(
      () => runPlanner(input(), { fetchImpl: async () => streamResponse([
        JSON.stringify({ choices: [{ delta: { content: typeof value === "string" ? value : JSON.stringify(value) } }] }),
        JSON.stringify({ choices: [{ finish_reason: "stop", delta: {} }] }),
        "[DONE]",
      ]), endpoint: "http://test.invalid/v1" }),
      /invalid|JSON|proposal/i,
    );
  }
});

test("rejects plans outside the configured child and depth bounds", async () => {
  await assert.rejects(
    () => runPlanner(input({ maxChildren: 2 }), { fetchImpl: async () => responseFor({ proposals: [proposal, { ...proposal, name: "Write planner tests" }, { ...proposal, name: "Validate planner input" }] }), endpoint: "http://test.invalid/v1" }),
    /2|maximum|child/i,
  );
  await assert.rejects(
    () => runPlanner(input({ currentRootDepth: 10 }), { fetchImpl: async () => responseFor({ proposals: [proposal, { ...proposal, name: "Write planner tests" }] }), endpoint: "http://test.invalid/v1" }),
    /depth/i,
  );
});

test("rejects incomplete proposals and non-imperative names", async () => {
  await assert.rejects(
    () => runPlanner(input(), { fetchImpl: async () => responseFor({ proposals: [{ ...proposal, name: "The planner work", tests: [] }, { ...proposal, name: "Write planner tests" }] }), endpoint: "http://test.invalid/v1" }),
    /imperative|complete|required|section/i,
  );
});

test("accepts general imperative names", async () => {
  for (const name of ["Document planner behavior", "Investigate failure causes"]) {
    const result = await runPlanner(input(), {
      fetchImpl: async () => responseFor({ proposals: [{ ...proposal, name }, { ...proposal, name: "Write planner tests" }] }),
      endpoint: "http://test.invalid/v1",
    });
    assert.equal(result.proposals[0].name, name);
  }
});

test("rejects empty, one-word, and non-actionable names", async () => {
  for (const name of ["", "Document", "The planner work", "Implementing planner behavior"]) {
    await assert.rejects(
      () => runPlanner(input(), { fetchImpl: async () => responseFor({ proposals: [{ ...proposal, name }, { ...proposal, name: "Write planner tests" }] }), endpoint: "http://test.invalid/v1" }),
      /imperative|complete|required|section/i,
    );
  }
});

test("parses a final SSE data event without a trailing newline", async () => {
  const result = await runPlanner(input(), {
    fetchImpl: async () => rawStreamResponse(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify({ proposals: [proposal, { ...proposal, name: "Write planner tests" }] }) } }] })}`),
    endpoint: "http://test.invalid/v1",
  });

  assert.equal(result.proposals.length, 2);
});

test("cancels an unclosed response body after DONE", async () => {
  let cancelled = false;
  const result = await runPlanner(input(), {
    fetchImpl: async () => rawStreamResponse(
      `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify({ proposals: [proposal, { ...proposal, name: "Write planner tests" }] }) } }] })}\n\ndata: [DONE]\n\n`,
      false,
      () => { cancelled = true; },
    ),
    endpoint: "http://test.invalid/v1",
  });

  assert.equal(result.proposals.length, 2);
  assert.equal(cancelled, true);
});

test("aborts a planner request when its runtime expires", async () => {
  const fetchImpl: PlannerFetch = async (_url, init) => await new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
  });

  await assert.rejects(
    () => runPlanner(input({ policy: { model: "planner-model", maxRunTimeSeconds: 0.01, maxOutputTokens: 10 } }), { fetchImpl, endpoint: "http://test.invalid/v1" }),
    /planner exceeded maximum run time/i,
  );
});

test("cancels an in-flight planner request", async () => {
  const cancellation = new AbortController();
  const fetchImpl: PlannerFetch = async (_url, init) => await new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
  });
  const run = runPlanner(input(), { fetchImpl, endpoint: "http://test.invalid/v1", cancellationSignal: cancellation.signal });
  cancellation.abort(new Error("planner activity cancelled"));

  await assert.rejects(run, /planner activity cancelled/);
});

test("rejects before fetch when cancellation is already requested", async () => {
  const cancellation = new AbortController();
  cancellation.abort(new Error("planner activity cancelled before start"));
  let fetchCalled = false;

  await assert.rejects(
    () => runPlanner(input(), {
      fetchImpl: async () => {
        fetchCalled = true;
        return responseFor({ proposals: [proposal, { ...proposal, name: "Write planner tests" }] });
      },
      endpoint: "http://test.invalid/v1",
      cancellationSignal: cancellation.signal,
    }),
    /planner activity cancelled before start/,
  );
  assert.equal(fetchCalled, false);
});
