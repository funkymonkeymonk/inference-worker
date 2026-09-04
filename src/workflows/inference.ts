import { proxyActivities } from "@temporalio/workflow";
import type { ExecuteInferenceInput, InferenceRequest, InferenceResult } from "../types.js";
import { modelForRequestType } from "../policy/model-routing.js";

interface InferenceActivities {
  executeInference(input: ExecuteInferenceInput): Promise<InferenceResult>;
}

const { executeInference } = proxyActivities<InferenceActivities>({
  startToCloseTimeout: "30 minutes",
  heartbeatTimeout: "2 minutes",
});

export async function InferenceWorkflow(request: InferenceRequest): Promise<InferenceResult> {
  return executeInference({ request, model: modelForRequestType(request.requestType) });
}
