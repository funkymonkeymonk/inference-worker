import type { InferenceRequestType } from "../types.js";

const models: Record<InferenceRequestType, string> = {
  fast: "omlx/qwen3.8-27b",
  reasoning: "omlx/qwen3.8-27b",
  agent: "omlx/qwen3.8-27b",
};

export function modelForRequestType(requestType: InferenceRequestType): string {
  return models[requestType];
}
