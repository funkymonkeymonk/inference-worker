# Workflow and Activity Reference

All workflows are exported from `src/workflows/index.ts` and run on the
configured task queue.

## `InferenceWorkflow`

Input: `InferenceRequest`.

The workflow selects a model from `requestType` and invokes
`executeInference`. The current policy maps `fast`, `reasoning`, and `agent` to
`omlx/qwen3.8-27b`. The Activity has a 30-minute start-to-close timeout and a
2-minute heartbeat timeout.

Result: `InferenceResult` with accumulated text, model name, and optional token
usage.

## `WorkItemWorkflow`

Input: `WorkItemInput` containing a task ID, title, context, repository root,
and `AgentPolicy`.

The workflow invokes one `executeAgent` Activity with a two-hour start-to-close
timeout, two-minute heartbeat timeout, and one attempt. It starts in `agent`
phase and returns `completed` when the agent reports success. An unsuccessful
result or thrown error changes state to `failed` and rethrows the error.

Query: `state`, returning `WorkItemState`.

The type includes phases and pull-request fields for future lifecycle work, but
the current workflow does not claim tasks, create workspaces, create pull
requests, wait for review, merge, or mark backend tasks done.

## `WorkDispatcherWorkflow`

Input: `DispatcherInput` with a required maximum implementation capacity and
optional polling interval or `runOnce` flag.

Each scan calls backend Activities for candidates. It claims each admitted task,
executes a `WorkItemWorkflow` child with workflow ID `work-item-<candidate id>`,
then marks success done or releases failure back to `todo`. `runOnce` returns
after one scan; otherwise the workflow sleeps for the polling interval.

Query: `state`, returning active, completed, and failed task IDs.

## Activities

| Activity | External behavior |
| --- | --- |
| `executeInference` | Streams `/chat/completions`, heartbeats accumulated text length, propagates cancellation, and returns a final result |
| `executeAgent` | Streams tool-capable completions, runs allowed tools, heartbeats progress, and enforces a wall-clock limit |
| `executePiTask` | Runs a Pi coding-agent session in a workspace; retained as a direct Activity but not used by current workflows |
| `listDispatchCandidates` | Asks the configured backend for eligible tasks |
| `claimTask` | Claims a backend task |
| `releaseTask` | Returns a failed backend task to `todo` |
| `markTaskDone` | Marks a successfully dispatched task done |

HTTP 4xx inference responses are non-retryable. Workspace-mutating agent work
and dispatch lifecycle Activities are configured for one attempt.
