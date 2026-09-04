import type { InferenceRequestType } from "../types.js";

const models: Record<InferenceRequestType, string> = {
  fast: "gpt-4o-mini",
  reasoning: "o3-mini",
  agent: "claude-sonnet-4-6",
};

export function modelForRequestType(requestType: InferenceRequestType): string {
  return models[requestType];
}
