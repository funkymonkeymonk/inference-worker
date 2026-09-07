import type { AgentToolName, DispatchCandidate, TaskBackend } from "../types.js";
import { YxTaskBackend } from "../backends/yx.js";
import { configFromEnvironment } from "../config.js";

function configuredBackend(): TaskBackend {
  const config = configFromEnvironment();
  const backendName = process.env.TASK_BACKEND ?? "yx";
  if (backendName !== "yx") throw new Error(`unsupported task backend: ${backendName}`);
  return new YxTaskBackend({
    repositoryRoot: process.env.REPOSITORY_ROOT ?? process.cwd(),
    policy: {
      model: config.agent.model,
      allowedTools: ["read", "write", "edit", "bash", "listToolFiles"] as AgentToolName[],
      maxRunTimeSeconds: config.agent.maxRunTimeSeconds,
      cleanupGraceSeconds: config.agent.cleanupGraceSeconds,
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

export function recordTaskFailure(id: string, reason: string): Promise<void> {
  return configuredBackend().recordFailure(id, reason);
}

export function markTaskDone(id: string): Promise<void> {
  return configuredBackend().markDone(id);
}
