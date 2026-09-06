import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runAgent, runAgentTool, type AgentFetch } from "./execute-agent.js";
import type { AgentPolicy, ExecuteAgentInput } from "../types.js";

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

function input(workspacePath: string, policy: AgentPolicy): ExecuteAgentInput {
  return {
    task: "Read notes.txt and summarize it.",
    workspacePath,
    policy,
  };
}

test("continues a streamed tool call with the tool result", async () => {
  const workspacePath = await mkdtemp(path.join(os.tmpdir(), "agent-test-"));
  await writeFile(path.join(workspacePath, "notes.txt"), "contract notes");
  const requests: Array<{ messages: unknown[]; tools: unknown[] }> = [];
  const responses = [
    streamResponse([
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call-1", type: "function", function: { name: "read", arguments: '{"path":"notes.txt"}' } }] } }] }),
      JSON.stringify({ choices: [{ finish_reason: "tool_calls", delta: {} }] }),
      "[DONE]",
    ]),
    streamResponse([
      JSON.stringify({ choices: [{ delta: { content: "The notes contain contract notes." } }] }),
      JSON.stringify({ choices: [{ finish_reason: "stop", delta: {} }] }),
      "[DONE]",
    ]),
  ];
  const fetchImpl: AgentFetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { messages: unknown[]; tools: unknown[] };
    requests.push(body);
    return responses.shift()!;
  };

  const result = await runAgent(input(workspacePath, { model: "test-model", allowedTools: ["read"], maxRunTimeSeconds: 10 }), {
    fetchImpl,
    endpoint: "http://test.invalid/v1",
  });

  assert.equal(result.text, "The notes contain contract notes.");
  assert.equal(requests.length, 2);
  assert.equal((requests[0].messages[0] as { role: string }).role, "system");
  assert.match((requests[0].messages[0] as { content: string }).content, /provided workspace/);
  assert.match((requests[0].messages[0] as { content: string }).content, /write or edit/);
  assert.deepEqual(requests[1].messages.at(-1), {
    role: "tool",
    tool_call_id: "call-1",
    content: "contract notes",
  });
  assert.equal((requests[0].tools as Array<{ function: { name: string } }>)[0].function.name, "read");
});

test("rejects a tool that is not in the policy allowlist", async () => {
  const workspacePath = await mkdtemp(path.join(os.tmpdir(), "agent-test-"));
  await assert.rejects(
    () => runAgentTool("bash", { command: "printf unsafe" }, workspacePath, ["read"]),
    /tool "bash" is not allowed/,
  );
});

test("lists files inside the workspace", async () => {
  const workspacePath = await mkdtemp(path.join(os.tmpdir(), "agent-test-"));
  await writeFile(path.join(workspacePath, "notes.txt"), "contract notes");
  assert.equal(await runAgentTool("listToolFiles", {}, workspacePath, ["listToolFiles"]), "notes.txt\n");
});

test("returns ordinary bash failures to the agent", async () => {
  const workspacePath = await mkdtemp(path.join(os.tmpdir(), "agent-test-"));
  const result = await runAgentTool("bash", { command: "printf output; printf error >&2; exit 1" }, workspacePath, ["bash"]);
  assert.match(result, /exit code 1/);
  assert.match(result, /output/);
  assert.match(result, /error/);
});

test("bounds bash execution time", async () => {
  const workspacePath = await mkdtemp(path.join(os.tmpdir(), "agent-test-"));
  await assert.rejects(
    () => runAgentTool("bash", { command: "sleep 1" }, workspacePath, ["bash"], { timeoutMs: 25 }),
    /timed out|Command failed/i,
  );
});

test("read tool is scoped to the workspace", async () => {
  const workspacePath = await mkdtemp(path.join(os.tmpdir(), "agent-test-"));
  await assert.rejects(
    () => runAgentTool("read", { path: "../outside.txt" }, workspacePath, ["read"]),
    /outside workspace/,
  );
});

test("cancels an in-flight model request", async () => {
  const workspacePath = await mkdtemp(path.join(os.tmpdir(), "agent-test-"));
  const cancellation = new AbortController();
  const fetchImpl: AgentFetch = async (_url, init) => await new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
  });
  const run = runAgent(input(workspacePath, { model: "test-model", allowedTools: ["read"], maxRunTimeSeconds: 10 }), {
    fetchImpl,
    endpoint: "http://test.invalid/v1",
    cancellationSignal: cancellation.signal,
  });
  cancellation.abort(new Error("agent activity cancelled"));
  await assert.rejects(run, /agent activity cancelled/);
});

test("rejects a model response truncated by the token limit", async () => {
  const workspacePath = await mkdtemp(path.join(os.tmpdir(), "agent-test-"));
  const fetchImpl: AgentFetch = async () => streamResponse([
    JSON.stringify({ choices: [{ finish_reason: "length", delta: { content: "partial" } }] }),
    "[DONE]",
  ]);
  await assert.rejects(
    () => runAgent(input(workspacePath, { model: "test-model", allowedTools: ["read"], maxRunTimeSeconds: 10 }), {
      fetchImpl,
      endpoint: "http://test.invalid/v1",
    }),
    /incomplete.*length/i,
  );
});
