import { execFile } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { Context } from "@temporalio/activity";
import type {
  AgentPolicy,
  AgentToolName,
  ExecuteAgentInput,
  ExecuteAgentResult,
} from "../types.js";

const execFileAsync = promisify(execFile);
const DEFAULT_BASH_TIMEOUT_MS = 60 * 60 * 1000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 16384;
const MAX_BASH_OUTPUT_BYTES = 1024 * 1024;
const IGNORED_DIRECTORY_NAMES = new Set([".git", ".yaks", ".devenv", "node_modules", "__pycache__"]);
const TOOL_SCHEMAS: Record<AgentToolName, object> = {
  read: {
    type: "function",
    function: {
      name: "read",
      description: "Read a UTF-8 file inside the workspace.",
      parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    },
  },
  write: {
    type: "function",
    function: {
      name: "write",
      description: "Write a UTF-8 file inside the workspace.",
      parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
    },
  },
  edit: {
    type: "function",
    function: {
      name: "edit",
      description: "Replace one exact text occurrence in a UTF-8 file inside the workspace.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" }, oldText: { type: "string" }, newText: { type: "string" } },
        required: ["path", "oldText", "newText"],
      },
    },
  },
  bash: {
    type: "function",
    function: {
      name: "bash",
      description: "Run a bounded bash command in the workspace.",
      parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
    },
  },
  listToolFiles: {
    type: "function",
    function: {
      name: "listToolFiles",
      description: "List files inside the workspace, optionally below a relative directory.",
      parameters: { type: "object", properties: { path: { type: "string" } } },
    },
  },
};

interface ToolCall {
  id: string;
  name: AgentToolName;
  arguments: string;
}

interface AgentMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

interface AgentChunk {
  text?: string;
  finishReason?: string;
  toolCalls?: Array<{ index: number; id?: string; name?: string; arguments?: string }>;
}

interface AgentResponse {
  text: string;
  finishReason?: string;
  toolCalls: Array<{ index: number; id: string; name: string; arguments: string }>;
}

export type AgentFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface AgentRunOptions {
  fetchImpl?: AgentFetch;
  endpoint?: string;
  cancellationSignal?: AbortSignal;
  heartbeat?: (details: unknown) => void;
  heartbeatIntervalMs?: number;
}

export interface ToolRunOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

function workspaceFile(workspacePath: string, requestedPath: string): string {
  const resolvedWorkspace = path.resolve(workspacePath);
  const resolvedPath = path.resolve(resolvedWorkspace, requestedPath);
  const relative = path.relative(resolvedWorkspace, resolvedPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`path is outside workspace: ${requestedPath}`);
  return resolvedPath;
}

async function listWorkspaceFiles(workspacePath: string, requestedPath = ""): Promise<string> {
  const root = workspaceFile(workspacePath, requestedPath || ".");
  const files: string[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.isDirectory() && IGNORED_DIRECTORY_NAMES.has(entry.name)) continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolutePath);
      else if (entry.isFile()) files.push(path.relative(workspacePath, absolutePath));
    }
  }

  await visit(root);
  return files.join("\n") + (files.length ? "\n" : "");
}

function assertToolAllowed(toolName: string, allowedTools: AgentToolName[]): asserts toolName is AgentToolName {
  if (!allowedTools.includes(toolName as AgentToolName)) throw new Error(`tool "${toolName}" is not allowed`);
}

export async function runAgentTool(
  toolName: string,
  args: Record<string, unknown>,
  workspacePath: string,
  allowedTools: AgentToolName[],
  options: ToolRunOptions = {},
): Promise<string> {
  assertToolAllowed(toolName, allowedTools);
  if (toolName === "read") return readFile(workspaceFile(workspacePath, String(args.path)), "utf8");
  if (toolName === "write") {
    await writeFile(workspaceFile(workspacePath, String(args.path)), String(args.content), "utf8");
    return "ok";
  }
  if (toolName === "edit") {
    const filePath = workspaceFile(workspacePath, String(args.path));
    const content = await readFile(filePath, "utf8");
    const oldText = String(args.oldText);
    const first = content.indexOf(oldText);
    if (first < 0) throw new Error(`text to edit was not found in ${args.path}`);
    if (content.indexOf(oldText, first + oldText.length) >= 0) throw new Error(`text to edit was not unique in ${args.path}`);
    await writeFile(filePath, `${content.slice(0, first)}${String(args.newText)}${content.slice(first + oldText.length)}`, "utf8");
    return "ok";
  }
  if (toolName === "listToolFiles") return listWorkspaceFiles(workspacePath, String(args.path ?? ""));
  try {
    const result = await execFileAsync("bash", ["-lc", String(args.command)], {
      cwd: workspacePath,
      timeout: options.timeoutMs ?? DEFAULT_BASH_TIMEOUT_MS,
      maxBuffer: MAX_BASH_OUTPUT_BYTES,
      signal: options.signal,
    });
    return `${result.stdout}${result.stderr}`;
  } catch (error) {
    const processError = error as NodeJS.ErrnoException & { killed?: boolean; signal?: string; stdout?: string; stderr?: string };
    if (processError.code === "ETIMEDOUT" || processError.killed || processError.signal === "SIGTERM") {
      throw new Error(`bash command timed out after ${options.timeoutMs ?? DEFAULT_BASH_TIMEOUT_MS}ms`);
    }
    const stdout = typeof processError.stdout === "string" ? processError.stdout : "";
    const stderr = typeof processError.stderr === "string" ? processError.stderr : String(processError.message ?? error);
    return `exit code ${processError.code ?? "unknown"}\n${stdout}${stderr}`;
  }
}

function parseChunk(data: string): AgentChunk | null {
  if (data === "[DONE]") return null;
  const chunk = JSON.parse(data) as {
    choices?: Array<{
      delta?: {
        content?: string;
        tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>;
      };
      finish_reason?: string;
    }>;
  };
  const choice = chunk.choices?.[0];
  return {
    text: choice?.delta?.content,
    finishReason: choice?.finish_reason,
    toolCalls: choice?.delta?.tool_calls?.map((call) => ({
      index: call.index,
      id: call.id,
      name: call.function?.name,
      arguments: call.function?.arguments,
    })),
  };
}

async function readAgentResponse(response: Response, heartbeat?: (details: unknown) => void): Promise<AgentResponse> {
  if (!response.ok || !response.body) throw new Error(`inference endpoint returned HTTP ${response.status}`);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  const calls = new Map<number, { id: string; name: string; arguments: string }>();
  let buffer = "";
  let text = "";
  let finishReason: string | undefined;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") {
        return { text, finishReason, toolCalls: [...calls.entries()].map(([index, call]) => ({ index, ...call })) };
      }
      const parsed = parseChunk(data);
      if (!parsed) continue;
      text += parsed.text ?? "";
      finishReason = parsed.finishReason ?? finishReason;
      for (const call of parsed.toolCalls ?? []) {
        const current = calls.get(call.index) ?? { id: call.id ?? `call-${call.index}`, name: call.name ?? "", arguments: "" };
        current.id = call.id ?? current.id;
        current.name = call.name ?? current.name;
        current.arguments += call.arguments ?? "";
        calls.set(call.index, current);
      }
      heartbeat?.({ textLength: text.length, toolCalls: calls.size });
    }
  }
  return { text, finishReason, toolCalls: [...calls.entries()].map(([index, call]) => ({ index, ...call })) };
}

export async function runAgent(input: ExecuteAgentInput, options: AgentRunOptions = {}): Promise<ExecuteAgentResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const endpoint = process.env.INFERENCE_ENDPOINT;
  const requestEndpoint = options.endpoint ?? endpoint;
  if (!requestEndpoint) throw new Error("INFERENCE_ENDPOINT is not configured");
  const timer = setTimeout(() => controller.abort(new Error("agent exceeded maximum run time")), input.policy.maxRunTimeSeconds * 1000);
  const onCancel = () => controller.abort(new Error("agent activity cancelled"));
  options.cancellationSignal?.addEventListener("abort", onCancel, { once: true });
  const heartbeatTimer = options.heartbeat
    ? setInterval(() => options.heartbeat?.({ phase: "waiting-for-inference" }), options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS)
    : undefined;
  const messages: AgentMessage[] = [
    {
      role: "system",
      content: "You are a coding agent operating in the provided workspace. Only call tools explicitly listed in the request; never invent MCP servers, tool names, or unavailable capabilities. All relative paths and shell commands must use the provided workspace as their current directory. Do not cd to guessed paths such as /home/user or /run/current-system/sw. For implementation tasks, use the write or edit tools to change files; do not paste a proposed implementation in chat and call that complete.",
    },
    {
      role: "user",
      content: `Complete the task and then respond with a concise summary.\n\nTask:\n${input.task}`,
    },
  ];
  let text = "";
  let toolCalls = 0;
  try {
    for (;;) {
      const response = await fetchImpl(`${requestEndpoint.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(process.env.INFERENCE_API_KEY ? { authorization: `Bearer ${process.env.INFERENCE_API_KEY}` } : {}) },
        body: JSON.stringify({
          model: input.policy.model,
          messages,
          tools: input.policy.allowedTools.map((name) => TOOL_SCHEMAS[name]),
          max_tokens: input.policy.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
          stream: true,
          stream_options: { include_usage: true },
        }),
        signal: controller.signal,
      });
      const responseData = await readAgentResponse(response, options.heartbeat);
      text += responseData.text ?? "";
      if (responseData.finishReason === "stop") return { completed: true, text, toolCalls };
      if (responseData.finishReason === "length" && !responseData.toolCalls.length) {
        messages.push({ role: "assistant", content: responseData.text });
        messages.push({ role: "user", content: "Continue from where you stopped. Do not repeat completed work; continue the task." });
        continue;
      }
      if (responseData.finishReason === "length") throw new Error("agent produced incomplete output: finish reason length");
      if (responseData.finishReason !== "tool_calls") throw new Error(`agent produced incomplete output: finish reason ${responseData.finishReason ?? "unknown"}`);
      const calls = responseData.toolCalls ?? [];
      if (!calls.length) throw new Error("model requested tool calls without call details");
      messages.push({
        role: "assistant",
        content: null,
        tool_calls: calls.map((call) => ({ id: call.id, type: "function", function: { name: call.name, arguments: call.arguments } })),
      });
      for (const call of calls) {
        const args = JSON.parse(call.arguments) as Record<string, unknown>;
        const result = await runAgentTool(call.name, args, input.workspacePath, input.policy.allowedTools, {
          signal: controller.signal,
          timeoutMs: input.policy.bashTimeoutMs,
        });
        messages.push({ role: "tool", tool_call_id: call.id, content: result });
        toolCalls += 1;
        options.heartbeat?.({ tool: call.name, toolCalls });
      }
    }
  } finally {
    clearTimeout(timer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    options.cancellationSignal?.removeEventListener("abort", onCancel);
  }
}

export async function executeAgent(input: ExecuteAgentInput): Promise<ExecuteAgentResult> {
  const activityContext = Context.current();
  return runAgent(input, {
    cancellationSignal: activityContext.cancellationSignal,
    heartbeat: (details) => activityContext.heartbeat(details),
  });
}
