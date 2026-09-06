# TypeScript Contracts

The canonical definitions are in `src/types.ts`.

## Direct inference

```ts
type InferenceRequestType = "fast" | "reasoning" | "agent";

interface InferenceRequest {
  requestType: InferenceRequestType;
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  temperature?: number;
  maxTokens?: number;
}

interface InferenceResult {
  text: string;
  model: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
}
```

## Agent execution

```ts
type AgentToolName = "read" | "write" | "edit" | "bash";

interface AgentPolicy {
  model: string;
  allowedTools: AgentToolName[];
  maxRunTimeSeconds: number;
}

interface ExecuteAgentInput {
  task: string;
  workspacePath: string;
  policy: AgentPolicy;
}
```

`read`, `write`, and `edit` resolve paths inside `workspacePath`. `bash` runs
through `bash -lc` in that directory with a 30-second default timeout and 1 MiB
output limit.

## Backend boundary

```ts
interface TaskBackend {
  listDispatchCandidates(input: { excludeIds: string[]; limit: number }): Promise<DispatchCandidate[]>;
  claim(id: string): Promise<void>;
  release(id: string, reason: string): Promise<void>;
  markDone(id: string): Promise<void>;
  getContext(id: string): Promise<string>;
  attachPullRequest(id: string, url: string): Promise<void>;
}
```

The current `YxTaskBackend` implements the interface by invoking `yx` in the
repository root. Temporal workflows depend on the interface, not on `yx`.

## Dispatch state

`DispatchCandidate` has an ID, title, context, kind (`review` or
`implementation`), and serialized `WorkItemInput`. `DispatcherState` contains
`activeTaskIds`, `completedTaskIds`, and `failedTaskIds`.

`WorkItemState` currently reports `taskId`, `phase`, `workspacePath`, and
`feedbackRound`; optional pull-request and failure fields are available when
set.
