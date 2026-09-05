import assert from "node:assert/strict";
import test from "node:test";
import type { DispatchCandidate, WorkItemInput, WorkItemState } from "./types.js";

test("backend-neutral task values survive JSON serialization", () => {
  const input: WorkItemInput = {
    taskId: "yak-123",
    title: "Define contracts",
    context: "Keep orchestration backend-neutral.",
    repositoryRoot: "/workspace/project",
    policy: { model: "test-model", allowedTools: ["read"], maxRunTimeSeconds: 60 },
  };
  const candidate: DispatchCandidate = {
    id: input.taskId,
    title: input.title,
    context: input.context,
    kind: "implementation",
    workflowInput: input,
  };
  const state: WorkItemState = {
    taskId: input.taskId,
    phase: "agent",
    workspacePath: input.repositoryRoot,
    feedbackRound: 0,
  };

  assert.deepEqual(JSON.parse(JSON.stringify(candidate)), candidate);
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
});
