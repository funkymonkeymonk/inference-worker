import type { AgentToolName, DispatchCandidate, TaskBackend } from "../types.js";
import { YxTaskBackend } from "../backends/yx.js";

function configuredBackend(): TaskBackend {
  const backendName = process.env.TASK_BACKEND ?? "yx";
  if (backendName !== "yx") throw new Error(`unsupported task backend: ${backendName}`);
  return new YxTaskBackend({
    repositoryRoot: process.env.REPOSITORY_ROOT ?? process.cwd(),
    policy: {
      model: process.env.AGENT_MODEL ?? "omlx/qwen3.8-27b",
      allowedTools: ["read", "write", "edit", "bash"] as AgentToolName[],
      maxRunTimeSeconds: Number(process.env.AGENT_MAX_RUN_TIME_SECONDS ?? 7200),
    },
  });
}

export function listDispatchCandidates(input: { excludeIds: string[]; limit: number }): Promise<DispatchCandidate[]> {
  return configuredBackend().listDispatchCandidates(input);
}

export function claimTask(id: string): Promise<void> {
  return configuredBackend().claim(id);
}

export function releaseTask(id: string, reason: string): Promise<void> {
  return configuredBackend().release(id, reason);
}

export function markTaskDone(id: string): Promise<void> {
  return configuredBackend().markDone(id);
}
