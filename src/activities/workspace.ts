import { execFile } from "node:child_process";
import { access, cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CancelledFailure, Context } from "@temporalio/activity";

export interface CreateWorkspaceInput {
  repositoryRoot: string;
  taskId: string;
}

export interface WorkspaceInfo {
  workspacePath: string;
  workspaceName: string;
  workspaceMode: "jj" | "copy";
}

export interface CleanupWorkspaceInput extends WorkspaceInfo {
  repositoryRoot: string;
}

export type WorkspaceCommandRunner = (cwd: string, command: string, args: string[], signal?: AbortSignal) => Promise<void>;

function defaultRunner(cwd: string, command: string, args: string[], signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd, maxBuffer: 4 * 1024 * 1024, signal }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function activityCancellationSignal(): AbortSignal | undefined {
  try {
    return Context.current().cancellationSignal;
  } catch {
    return undefined;
  }
}

async function isJjRepository(repositoryRoot: string): Promise<boolean> {
  try {
    await access(path.join(repositoryRoot, ".jj"));
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

function workspaceName(taskId: string, workspacePath: string): string {
  const safeTaskId = taskId.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 40) || "task";
  return `inference-${safeTaskId}-${path.basename(workspacePath).split("-").at(-1)}`;
}

export async function createWorkspace(
  input: CreateWorkspaceInput,
  runner: WorkspaceCommandRunner = defaultRunner,
): Promise<WorkspaceInfo> {
  const workspacePath = await mkdtemp(path.join(os.tmpdir(), "inference-worker-workspace-"));
  const name = workspaceName(input.taskId, workspacePath);
  await rm(workspacePath, { recursive: true, force: true });
  const signal = activityCancellationSignal();
  let completed = false;
  let workspaceMode: WorkspaceInfo["workspaceMode"] | undefined;
  try {
    if (signal?.aborted) throw new CancelledFailure("Activity cancelled");
    if (await isJjRepository(input.repositoryRoot)) {
      workspaceMode = "jj";
      await runner(input.repositoryRoot, "jj", ["workspace", "add", "--name", name, workspacePath], signal);
    } else {
      workspaceMode = "copy";
      // Plain temporary repositories used by tests and local tools do not have jj metadata.
      await cp(input.repositoryRoot, workspacePath, { recursive: true });
      if (signal?.aborted) throw new CancelledFailure("Activity cancelled");
    }
    completed = true;
    return { workspacePath, workspaceName: name, workspaceMode };
  } finally {
    if (!completed && workspaceMode === "jj") {
      try {
        await runner(input.repositoryRoot, "jj", ["workspace", "forget", name], signal);
      } catch {
        // Preserve the workspace creation failure if cleanup is also unsuccessful.
      }
    }
    if (!completed) await rm(workspacePath, { recursive: true, force: true });
  }
}

export async function cleanupWorkspace(
  input: CleanupWorkspaceInput,
  runner: WorkspaceCommandRunner = defaultRunner,
): Promise<void> {
  try {
    await access(input.workspacePath);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  if (input.workspaceMode === "jj") {
    await runner(input.repositoryRoot, "jj", ["workspace", "forget", input.workspaceName]);
  }
  await rm(input.workspacePath, { recursive: true, force: true });
}
