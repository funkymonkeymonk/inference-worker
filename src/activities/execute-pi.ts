import { Context } from "@temporalio/activity";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { PiTaskInput, PiTaskResult } from "../types.js";

const HEARTBEAT_INTERVAL_MS = 30_000;
const DEFAULT_MAX_RUN_TIME_SECONDS = 2 * 60 * 60;

export function buildPiPrompt(task: string): string {
  return `${task}\n\nComplete this task and report what changed.`;
}

export async function executePiTask(input: PiTaskInput): Promise<PiTaskResult> {
  const activityContext = Context.current();
  const abort = new AbortController();
  const maxRunMs = (input.maxRunTimeSeconds ?? DEFAULT_MAX_RUN_TIME_SECONDS) * 1000;
  const startedAt = Date.now();
  let lastEvent = "starting";
  const ticker = (async () => {
    while (!abort.signal.aborted) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, HEARTBEAT_INTERVAL_MS);
        abort.signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
      });
      if (abort.signal.aborted) break;
      const elapsed = Date.now() - startedAt;
      if (elapsed >= maxRunMs) {
        abort.abort(new Error(`Pi task exceeded max run time of ${Math.round(maxRunMs / 1000)}s`));
        break;
      }
      try {
        activityContext.heartbeat(`pi: ${lastEvent} (${Math.round(elapsed / 1000)}s elapsed)`);
      } catch {
        abort.abort();
        break;
      }
    }
  })();
  const onCancel = () => abort.abort(new Error("Pi activity cancelled"));
  activityContext.cancellationSignal.addEventListener("abort", onCancel, { once: true });

  let session: { prompt(text: string): Promise<void>; dispose(): void } | undefined;
  let output = "";
  try {
    const modelRuntime = await ModelRuntime.create({ refreshOnCreate: false });
    if (process.env.LITELLM_API_KEY) await modelRuntime.setRuntimeApiKey("litellm", process.env.LITELLM_API_KEY);
    const loader = new DefaultResourceLoader({ cwd: input.workspacePath, agentDir: getAgentDir() });
    await loader.reload();
    const created = await createAgentSession({
      cwd: input.workspacePath,
      tools: input.tools ?? ["read", "bash", "edit", "write"],
      modelRuntime,
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(input.workspacePath),
    });
    session = created.session;
    if (input.model) {
      const available = await modelRuntime.getAvailable();
      const selected = available.find((model) => model.id === input.model || model.id.includes(input.model!));
      if (!selected) throw new Error(`Pi model "${input.model}" is not available`);
      await created.session.setModel(selected);
    }
    created.session.subscribe((event) => {
      if (event.type === "tool_execution_start") lastEvent = `tool:${event.toolName}`;
      else if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
        output += event.assistantMessageEvent.delta;
        lastEvent = "text";
      } else lastEvent = event.type;
    });
    await Promise.race([
      created.session.prompt(buildPiPrompt(input.task)),
      new Promise<never>((_, reject) => {
        if (abort.signal.aborted) reject(abort.signal.reason);
        else abort.signal.addEventListener("abort", () => reject(abort.signal.reason), { once: true });
      }),
    ]);
    return { completed: true, text: output };
  } finally {
    abort.abort();
    await ticker;
    activityContext.cancellationSignal.removeEventListener("abort", onCancel);
    session?.dispose();
  }
}
