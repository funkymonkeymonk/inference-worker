export type InferenceRequestType = "fast" | "reasoning" | "agent";

export interface InferenceMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface InferenceRequest {
  requestType: InferenceRequestType;
  messages: InferenceMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface InferenceUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface InferenceResult {
  text: string;
  model: string;
  usage?: InferenceUsage;
}

export interface ExecuteInferenceInput {
  request: InferenceRequest;
  model: string;
}

export interface PiTaskInput {
  task: string;
  workspacePath: string;
  model?: string;
  tools?: string[];
  maxRunTimeSeconds?: number;
}

export interface PiTaskResult {
  completed: boolean;
  text: string;
}

export const TASK_QUEUE = "inference-worker";
