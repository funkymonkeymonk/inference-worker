import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CancelledFailure } from "@temporalio/activity";
import test from "node:test";
import { cleanupWorkspace, createWorkspace, type WorkspaceCommandRunner } from "./workspace.js";

test("creates separate jj workspaces for separate runs", async () => {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-repository-"));
  await mkdir(path.join(repositoryRoot, ".jj"));
  const commands: string[][] = [];
  const runner: WorkspaceCommandRunner = async (_cwd, command, args) => {
    commands.push([command, ...args]);
    if (command === "jj" && args[0] === "workspace" && args[1] === "add") {
      await mkdir(args.at(-1)!, { recursive: true });
    }
  };
  const workspaces = [] as Array<Awaited<ReturnType<typeof createWorkspace>>>;

  try {
    workspaces.push(await createWorkspace({ repositoryRoot, taskId: "yak-1" }, runner));
    workspaces.push(await createWorkspace({ repositoryRoot, taskId: "yak-2" }, runner));

    assert.notEqual(workspaces[0].workspacePath, workspaces[1].workspacePath);
    assert.notEqual(workspaces[0].workspaceName, workspaces[1].workspaceName);
    assert.equal(workspaces[0].workspaceMode, "jj");
    assert.equal(workspaces[1].workspaceMode, "jj");
    await access(workspaces[0].workspacePath);
    await access(workspaces[1].workspacePath);
    assert.equal(commands.filter(([command, ...args]) => command === "jj" && args[0] === "workspace" && args[1] === "add").length, 2);
  } finally {
    await Promise.all(workspaces.map((workspace) => cleanupWorkspace({ ...workspace, repositoryRoot }, runner)));
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("cleanup removes a workspace and is idempotent", async () => {
  const workspacePath = await mkdtemp(path.join(os.tmpdir(), "workspace-cleanup-"));
  const forgotten: string[] = [];
  const runner: WorkspaceCommandRunner = async (_cwd, command, args) => {
    if (command === "jj" && args[0] === "workspace" && args[1] === "forget") forgotten.push(args[2]);
  };

  await cleanupWorkspace({ repositoryRoot: "/repository", workspaceName: "run-1", workspaceMode: "jj", workspacePath }, runner);
  await cleanupWorkspace({ repositoryRoot: "/repository", workspaceName: "run-1", workspaceMode: "jj", workspacePath }, runner);

  await assert.rejects(access(workspacePath), /ENOENT/);
  assert.deepEqual(forgotten, ["run-1"]);
});

test("preserves jj add failures instead of falling back to a copy", async () => {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-jj-failure-repository-"));
  await mkdir(path.join(repositoryRoot, ".jj"));
  let workspacePath: string | undefined;
  const commands: string[][] = [];
  const runner: WorkspaceCommandRunner = async (_cwd, command, args) => {
    commands.push([command, ...args]);
    workspacePath = args.at(-1);
    if (args[0] === "workspace" && args[1] === "add") throw new Error("jj workspace add failed");
    if (args[0] === "workspace" && args[1] === "forget") throw new Error("jj workspace forget failed");
  };

  await assert.rejects(
    createWorkspace({ repositoryRoot, taskId: "yak-fail" }, runner),
    /jj workspace add failed/,
  );
  assert.ok(workspacePath);
  await assert.rejects(access(workspacePath), /ENOENT/);
  assert.deepEqual(commands.map(([, ...args]) => args.slice(0, 3)), [
    ["workspace", "add", "--name"],
    ["workspace", "forget", commands[0].at(-2)],
  ]);
  await rm(repositoryRoot, { recursive: true, force: true });
});

test("creates and cleans up a fallback copy without jj forget", async () => {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-copy-repository-"));
  await mkdir(path.join(repositoryRoot, "src"), { recursive: true });
  const commands: string[][] = [];
  const runner: WorkspaceCommandRunner = async (_cwd, command, args) => {
    commands.push([command, ...args]);
  };

  try {
    const workspace = await createWorkspace({ repositoryRoot, taskId: "yak-copy" }, runner);
    assert.equal(workspace.workspaceMode, "copy");
    await access(path.join(workspace.workspacePath, "src"));

    await cleanupWorkspace({ ...workspace, repositoryRoot }, runner);

    await assert.rejects(access(workspace.workspacePath), /ENOENT/);
    assert.deepEqual(commands, []);
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("removes the temporary path when fallback copy fails", async () => {
  const temporaryWorkspaceEntries = async () => (await readdir(os.tmpdir())).filter((entry) => entry.startsWith("inference-worker-workspace-"));
  const before = await temporaryWorkspaceEntries();

  await assert.rejects(createWorkspace({ repositoryRoot: "/missing/repository", taskId: "yak-fail" }), /ENOENT/);
  assert.deepEqual(await temporaryWorkspaceEntries(), before);
});

test("preserves operational jj forget failures", async () => {
  const workspacePath = await mkdtemp(path.join(os.tmpdir(), "workspace-forget-"));
  const runner: WorkspaceCommandRunner = async () => {
    throw new Error("jj workspace forget failed");
  };

  await assert.rejects(
    cleanupWorkspace({ repositoryRoot: "/repository", workspaceName: "run-1", workspaceMode: "jj", workspacePath }, runner),
    /jj workspace forget failed/,
  );
  await access(workspacePath);
  await rm(workspacePath, { recursive: true, force: true });
});

test("does not fall back or leak the path when workspace creation is cancelled", async () => {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-cancel-repository-"));
  await mkdir(path.join(repositoryRoot, ".jj"));
  let workspacePath: string | undefined;
  const runner: WorkspaceCommandRunner = async (_cwd, _command, args) => {
    workspacePath = args.at(-1);
    throw new CancelledFailure("TIMED_OUT");
  };

  try {
    await assert.rejects(
      createWorkspace({ repositoryRoot, taskId: "yak-cancel" }, runner),
      (error: unknown) => error instanceof CancelledFailure && error.message === "TIMED_OUT",
    );
    assert.ok(workspacePath);
    await assert.rejects(access(workspacePath), /ENOENT/);
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});
