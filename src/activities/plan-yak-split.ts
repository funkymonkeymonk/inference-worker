import { Context } from "@temporalio/activity";
import type { PlanYakSplitInput, SplitPlan, SplitProposal } from "../types.js";

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;

export type PlannerFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface PlannerRunOptions {
  fetchImpl?: PlannerFetch;
  endpoint?: string;
  cancellationSignal?: AbortSignal;
  heartbeat?: (details: unknown) => void;
  heartbeatIntervalMs?: number;
}

interface PlannerResponse {
  text: string;
  toolCalls: number;
  finishReason?: string;
}

const NON_ACTIONABLE_NAME_STARTS = new Set([
  "a", "an", "change", "changes", "feature", "failure", "implementation", "item", "items", "issue", "plan", "planner", "task", "the", "this", "those", "these", "that", "work",
]);

function isImperativeName(name: string): boolean {
  const words = name.trim().split(/\s+/);
  if (words.length < 2) return false;
  const firstWord = words[0].toLowerCase();
  if (!/^[a-z][a-z'-]*$/.test(firstWord)) return false;
  if (NON_ACTIONABLE_NAME_STARTS.has(firstWord) || firstWord.endsWith("ing")) return false;
  return words.slice(1).some((word) => /[a-z]/i.test(word));
}

function validateProposal(value: unknown, index: number): SplitProposal {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`proposal ${index} is not an object`);
  const proposal = value as Record<string, unknown>;
  if (typeof proposal.name !== "string" || !isImperativeName(proposal.name)) {
    throw new Error(`proposal ${index} must have an imperative name`);
  }
  const requiredArrays = ["scope", "acceptanceCriteria", "tests", "dependencies", "nonGoals"];
  for (const field of requiredArrays) {
    const value = proposal[field];
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
      throw new Error(`proposal ${index} requires a complete ${field} section`);
    }
  }
  if (typeof proposal.goal !== "string" || !proposal.goal.trim()) throw new Error(`proposal ${index} requires a complete goal section`);
  return proposal as unknown as SplitProposal;
}

function validatePlan(value: unknown, input: PlanYakSplitInput): SplitPlan {
  if (!Number.isSafeInteger(input.currentRootDepth) || input.currentRootDepth < 0 ||
      !Number.isSafeInteger(input.maxRootDepth) || input.maxRootDepth <= 0 || input.currentRootDepth >= input.maxRootDepth) {
    throw new Error("planner cannot split a yak at or beyond the maximum root depth");
  }
  if (!Number.isSafeInteger(input.maxChildren) || input.maxChildren < 2) throw new Error("planner maximum child count must allow at least 2 proposals");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("planner response must be a JSON object");
  const proposals = (value as { proposals?: unknown }).proposals;
  if (!Array.isArray(proposals) || proposals.length < 2 || proposals.length > Math.min(input.maxChildren, 5)) {
    throw new Error(`planner must return 2-${Math.min(input.maxChildren, 5)} proposals`);
  }
  return { proposals: proposals.map((proposal, index) => validateProposal(proposal, index)) };
}

async function readPlannerResponse(response: Response, heartbeat?: (details: unknown) => void): Promise<PlannerResponse> {
  if (!response.ok || !response.body) throw new Error(`inference endpoint returned HTTP ${response.status}`);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let text = "";
  let toolCalls = 0;
  let finishReason: string | undefined;
  let readerDone = false;
  const processLine = (line: string): boolean => {
    if (!line.startsWith("data: ")) return false;
    const data = line.slice(6).trim();
    if (data === "[DONE]") return true;
    const chunk = JSON.parse(data) as {
      choices?: Array<{ delta?: { content?: string; tool_calls?: unknown[] }; finish_reason?: string }>;
    };
    const choice = chunk.choices?.[0];
    if (choice?.delta?.tool_calls?.length) toolCalls += choice.delta.tool_calls.length;
    text += choice?.delta?.content ?? "";
    finishReason = choice?.finish_reason ?? finishReason;
    heartbeat?.({ textLength: text.length });
    return false;
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        readerDone = true;
        break;
      }
      buffer += value;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (processLine(line)) return { text, toolCalls, finishReason };
      }
    }
    if (buffer) processLine(buffer);
    return { text, toolCalls, finishReason };
  } finally {
    if (!readerDone) {
      try {
        await reader.cancel();
      } catch {
        // The stream may already have failed; releasing the reader is still safe.
      }
    }
    reader.releaseLock();
  }
}

export async function runPlanner(input: PlanYakSplitInput, options: PlannerRunOptions = {}): Promise<SplitPlan> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = options.endpoint ?? process.env.INFERENCE_ENDPOINT;
  if (!endpoint) throw new Error("INFERENCE_ENDPOINT is not configured");
  if (options.cancellationSignal?.aborted) {
    throw options.cancellationSignal.reason ?? new Error("planner activity cancelled");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("planner exceeded maximum run time")), input.policy.maxRunTimeSeconds * 1000);
  const onCancel = () => controller.abort(new Error("planner activity cancelled"));
  options.cancellationSignal?.addEventListener("abort", onCancel, { once: true });
  if (options.cancellationSignal?.aborted) onCancel();
  const heartbeatTimer = options.heartbeat
    ? setInterval(() => options.heartbeat?.({ phase: "waiting-for-planner" }), options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS)
    : undefined;
  const plannerInput = {
    title: input.title,
    context: input.context,
    failureReason: input.failureReason,
    currentRootDepth: input.currentRootDepth,
    maxRootDepth: input.maxRootDepth,
    maxChildCount: input.maxChildren,
  };
  try {
    const response = await fetchImpl(`${endpoint.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(process.env.INFERENCE_API_KEY ? { authorization: `Bearer ${process.env.INFERENCE_API_KEY}` } : {}) },
      body: JSON.stringify({
        model: input.policy.model,
        messages: [
          { role: "system", content: "Return only strict JSON matching {\"proposals\":[...]} with 2 to 5 imperative child-yak proposals. Do not use tools." },
          { role: "user", content: JSON.stringify(plannerInput) },
        ],
        max_tokens: input.policy.maxOutputTokens,
        stream: true,
      }),
      signal: controller.signal,
    });
    const plannerResponse = await readPlannerResponse(response, options.heartbeat);
    if (plannerResponse.toolCalls) throw new Error("planner response contained tool calls");
    if (plannerResponse.finishReason === "length") throw new Error("planner response was truncated");
    let parsed: unknown;
    try {
      parsed = JSON.parse(plannerResponse.text);
    } catch (error) {
      throw new Error(`planner returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    return validatePlan(parsed, input);
  } finally {
    clearTimeout(timer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    options.cancellationSignal?.removeEventListener("abort", onCancel);
  }
}

export async function planYakSplit(input: PlanYakSplitInput): Promise<SplitPlan> {
  const activityContext = Context.current();
  return runPlanner(input, {
    cancellationSignal: activityContext.cancellationSignal,
    heartbeat: (details) => activityContext.heartbeat(details),
  });
}
