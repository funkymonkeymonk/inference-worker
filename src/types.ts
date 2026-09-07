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

export type AgentToolName = "read" | "write" | "edit" | "bash" | "listToolFiles";

export const DEFAULT_WORK_ITEM_CLEANUP_GRACE_SECONDS = 300;

export interface AgentPolicy {
  model: string;
  allowedTools: AgentToolName[];
  maxRunTimeSeconds: number;
  cleanupGraceSeconds?: number;
}

export interface ExecuteAgentInput {
  task: string;
  workspacePath: string;
  policy: AgentPolicy;
}

export interface ExecuteAgentResult {
  completed: boolean;
  text: string;
  toolCalls: number;
}

export interface SplitProposal {
  name: string;
  goal: string;
  scope: string[];
  acceptanceCriteria: string[];
  tests: string[];
  dependencies: string[];
  nonGoals: string[];
}

export interface SplitPlan {
  proposals: SplitProposal[];
}

export interface PlannerPolicy {
  model: string;
  maxRunTimeSeconds: number;
  maxOutputTokens: number;
}

export interface PlanYakSplitInput {
  title: string;
  context: string;
  failureReason: string;
  currentRootDepth: number;
  maxRootDepth: number;
  maxChildren: number;
  policy: PlannerPolicy;
}

export type WorkItemPhase = "queued" | "claimed" | "agent" | "review" | "merged" | "completed" | "released" | "failed";

export interface WorkItemInput {
  taskId: string;
  title: string;
  context: string;
  repositoryRoot: string;
  policy: AgentPolicy;
}

export interface WorkItemState {
  taskId: string;
  phase: WorkItemPhase;
  workspacePath?: string;
  pullRequestUrl?: string;
  pullRequestNumber?: number;
  feedbackRound: number;
  failure?: string;
}

export type DispatchCandidateKind = "review" | "implementation";

export interface DispatchCandidate {
  id: string;
  title: string;
  context: string;
  kind: DispatchCandidateKind;
  workflowInput: WorkItemInput;
}

export interface TaskBackend {
  listDispatchCandidates(input: { excludeIds: string[]; limit: number }): Promise<DispatchCandidate[]>;
  claim(id: string): Promise<void>;
  release(id: string, reason: string): Promise<void>;
  recordFailure(id: string, reason: string): Promise<void>;
  markDone(id: string): Promise<void>;
  getContext(id: string): Promise<string>;
  attachPullRequest(id: string, url: string): Promise<void>;
}

export interface DispatcherInput {
  pollIntervalMs?: number;
  maxConcurrentImplementations: number;
  runOnce?: boolean;
  state?: DispatcherState;
}

export interface DispatcherState {
  activeTaskIds: string[];
  completedTaskIds: string[];
  failedTaskIds: string[];
}

export const TASK_QUEUE = "inference-worker";
