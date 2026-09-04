import { Context } from "@temporalio/activity";
import { ApplicationFailure } from "@temporalio/common";
import type { ExecuteInferenceInput, InferenceResult, InferenceUsage } from "../types.js";

const REQUEST_TIMEOUT_MS = 30 * 60 * 1000;

export function chatCompletionsUrl(endpoint: string): string {
  return `${endpoint.replace(/\/+$/, "")}/chat/completions`;
}

export function parseSseData(data: string): { text?: string; usage?: InferenceUsage } | null {
  if (data === "[DONE]") return null;
  const chunk = JSON.parse(data) as {
    choices?: Array<{ delta?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  const result: { text?: string; usage?: InferenceUsage } = {};
  const text = chunk.choices?.[0]?.delta?.content;
  if (text) result.text = text;
  if (chunk.usage) {
    result.usage = {
      promptTokens: chunk.usage.prompt_tokens,
      completionTokens: chunk.usage.completion_tokens,
      totalTokens: chunk.usage.total_tokens,
    };
  }
  return result;
}

export async function executeInference({ request, model }: ExecuteInferenceInput): Promise<InferenceResult> {
  const activityContext = Context.current();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("inference request timed out")), REQUEST_TIMEOUT_MS);
  const cancel = () => controller.abort(new Error("inference activity cancelled"));
  activityContext.cancellationSignal.addEventListener("abort", cancel, { once: true });

  try {
    const endpoint = process.env.INFERENCE_ENDPOINT;
    if (!endpoint) throw new Error("INFERENCE_ENDPOINT is not configured");
    const response = await fetch(chatCompletionsUrl(endpoint), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.INFERENCE_API_KEY ? { authorization: `Bearer ${process.env.INFERENCE_API_KEY}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages: request.messages,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.text();
      const message = `inference endpoint returned HTTP ${response.status}: ${detail}`;
      if (response.status >= 400 && response.status < 500) {
        throw ApplicationFailure.nonRetryable(message, "InferenceClientError", response.status);
      }
      throw new Error(message);
    }
    if (!response.body) throw new Error("inference endpoint returned no response body");

    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    let text = "";
    let usage: InferenceUsage | undefined;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const parsed = parseSseData(line.slice(6).trim());
        if (!parsed) continue;
        text += parsed.text ?? "";
        usage = parsed.usage ?? usage;
        activityContext.heartbeat({ chars: text.length });
      }
    }
    return { text, model, ...(usage ? { usage } : {}) };
  } finally {
    clearTimeout(timer);
    activityContext.cancellationSignal.removeEventListener("abort", cancel);
  }
}
