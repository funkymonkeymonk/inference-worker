# Architecture

The worker separates deterministic Temporal orchestration from side effects.
Workflows decide which Activity or child workflow runs. Activities perform HTTP,
filesystem, process, task-backend, and coding-agent operations.

```text
client
  -> InferenceWorkflow -> executeInference -> OpenAI-compatible endpoint

worker startup
  -> WorkDispatcherWorkflow
       -> task-backend Activities -> yx
       -> WorkItemWorkflow -> executeAgent -> endpoint + workspace tools
```

## Direct inference

`InferenceWorkflow` receives a serializable request and chooses a model through
the workflow-owned routing table. `executeInference` sends a streaming request,
accumulates text, emits heartbeats, and handles cancellation. The endpoint and
API key remain Activity concerns and never enter workflow history as connection
configuration.

## Dispatch

The worker starts one dispatcher workflow per configured workflow ID. The
dispatcher asks the backend for ordered candidates, claims a candidate, and
starts a child work item. The `yx` adapter owns eligibility, tag parsing,
ordering, and `yx` command invocation. This keeps a future task backend from
requiring changes to Temporal orchestration.

## Agent execution

The current work item invokes a single custom agent loop. The model emits
streaming text or tool calls; the Activity executes the allowlisted tool and
returns its result to the model until the model stops. Tool calls are bounded by
the workspace path, shell timeout, output limit, cancellation signal, and agent
wall-clock limit.

The repository also contains a Pi Activity implementation. It is not part of
the current `WorkItemWorkflow` path.

## Durability and retry boundaries

Temporal records workflow progress and resumes workflows after worker restart.
Activities heartbeat during long work and receive cancellation signals. HTTP
inference can retry according to Temporal defaults except for client errors;
mutating task and workspace operations use one attempt because replaying them is
not assumed safe.
