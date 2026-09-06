# Task Dispatch Design

## Goal

Extend this repository's Temporal inference worker with an automatic task
dispatcher based initially on `yx`, while keeping the workflow independent of
any particular task-management tool. The worker should implement the
yaketyyak lifecycle without importing yaketyyak's worker code.

The service remains installable and configurable through the Nix flake.

## Architecture

The worker hosts three related workflow responsibilities:

- `InferenceWorkflow` handles direct model requests.
- `WorkItemWorkflow` executes one task from claim through merged pull request
  and completion.
- `WorkDispatcherWorkflow` continuously admits work into available agent
  implementation slots.

There is one configured task backend per service instance. `yx` is the first
backend. The workflow and dispatcher use backend-neutral interfaces; they do
not parse `yx` tags, invoke `yx`, or understand Jira/Linear concepts.

The dispatcher has a singleton workflow ID per repository. It periodically
reconciles active work-item workflow IDs, calculates available implementation
slots, asks the backend for ordered candidates, and starts work-item workflows.
The backend's returned order is authoritative. The dispatcher never assigns or
rewrites priority.

## Yak Tree Structure

Each coherent body of work is represented by one root yak and implementation
descendants. The root is a review-only final check covering documentation,
complete specification, code organization, tests, and acceptance criteria. It
is not implementation work and becomes eligible only after every descendant is
terminal.

The root owns the `@g2g` and `@priority:<integer>` tags. Descendants inherit
those tags and must not carry their own copies. At equal root priority, deeper
descendants are admitted before shallower descendants. This makes the yx tree
the prerequisite and ordering model while keeping the Temporal workflows
backend-neutral.

## Backend Boundary

The backend owns all task-tool behavior:

```ts
interface TaskBackend {
  listDispatchCandidates(input: {
    excludeIds: string[];
    limit: number;
  }): Promise<DispatchCandidate[]>;
  claim(id: string): Promise<void>;
  release(id: string, reason: string): Promise<void>;
  markDone(id: string): Promise<void>;
  getContext(id: string): Promise<string>;
  attachPullRequest(id: string, url: string): Promise<void>;
}
```

`DispatchCandidate` contains only the information required to start a
workflow, such as a stable ID, title, context, and serialized workflow input.
The contract guarantees that candidates are returned in admission order.

The `yx` adapter owns these rules:

- The root yak owns both `@g2g` and a valid `@priority:<integer>` tag; descendants
  inherit those values and do not need their own tags.
- Only `todo` descendants are implementation candidates. The root yak is never
  an implementation candidate.
- The root yak is a review-only final check for documentation, spec completion,
  code quality, and tests. It becomes eligible only after every descendant is
  terminal.
- Missing or malformed root priority tags exclude the entire tree.
- Candidates are ordered by root priority descending, tree depth descending,
  review kind, creation time ascending, and stable yak ID ascending.

The adapter also owns `yx start`, release, completion, context, PR fields, and
repository synchronization. A future Jira or Linear adapter can map its own
priority model and lifecycle into the same candidate contract without changes
to Temporal orchestration.

## Dispatch And Concurrency

The dispatcher uses two logical classes of backend candidates:

1. Review work for pull requests with actionable `CHANGES_REQUESTED` feedback.
2. New implementation work.
3. The root's final review after all descendants are terminal.

The backend applies root priority and tree depth before the review kind. Review
work wins only when those ordering keys tie. A free implementation slot always
admits the first returned candidate.

Review work never preempts an agent Activity that is already running. It wins
at the next available slot. A task waiting for pull request review or merge
does not consume an implementation slot.

The dispatcher does not keep an in-memory queue. The task backend remains the
source of truth, so priority changes, removed approval tags, resolved blockers,
and new tasks are observed on the next scan. Starting a workflow with an
existing stable ID is treated as an already-dispatched task.

## Work-Item Workflow

`WorkItemWorkflow` is deterministic orchestration. Activities own all side
effects:

- Claim and release the task.
- Create and clean up an isolated `jj` workspace.
- Execute the coding agent.
- Create and update the draft pull request.
- Read pull request state and review feedback.
- Mark the task complete.

The workflow exposes queryable state containing task ID, phase, workspace, PR
URL, PR number, and feedback round. A cancellation or `wont-do` signal
releases the task and cleans up the workspace at the next safe Activity
boundary.

Waiting for review uses Temporal timers plus short pull-request polling
Activities. It does not use one long-running polling Activity, so waiting does
not consume worker Activity capacity. Review feedback updates durable workflow
state and makes the task eligible for the review queue.

Activities that mutate a workspace or task state use one attempt unless they
are explicitly made idempotent. Network reads and safe backend operations may
use bounded retries.

## Agent Execution

Pi and LiteLLM are not required. The worker owns a single agent Activity that
uses the existing OpenAI-compatible inference endpoint:

```text
WorkItemWorkflow
  -> ExecuteAgent Activity
       -> call INFERENCE_ENDPOINT
       -> execute an allowed tool
       -> send the tool result back
       -> repeat until completion
```

The initial tool set is hardcoded in TypeScript as `read`, `write`, `edit`,
and bounded `bash`. Implementations are kept behind a tool registry and the
agent receives a typed `AgentPolicy` containing model, allowed tools, and the
maximum run time. Per-repository policy is intentionally not implemented yet,
but this boundary permits it later without changing workflow orchestration.

The agent Activity heartbeats during model calls and tool execution, handles
Temporal cancellation, and enforces a wall-clock limit. It has no automatic
retry because workspace mutations are not safely repeatable.

The inference endpoint must support OpenAI-compatible streaming tool calls.
Direct inference and agent execution use the same endpoint and optional API
key; there is no LiteLLM-specific configuration.

## Nix Service

The flake exposes one package and one Darwin module. The module starts one
worker process with both direct inference and task workflows registered.

The minimal service configuration is conceptually:

```nix
services.inference-worker = {
  enable = true;
  repositoryRoot = "/Users/me/src/project";
  taskBackend = "yx";
  dispatcher = {
    pollInterval = "60s";
    maxConcurrentImplementations = 2;
  };
  inference.endpoint = "http://127.0.0.1:8081/v1";
};
```

The service environment contains only process configuration and credentials:

- `TEMPORAL_ADDRESS`
- `TEMPORAL_NAMESPACE`
- `TEMPORAL_TASK_QUEUE`
- `REPOSITORY_ROOT`
- `INFERENCE_ENDPOINT`
- optional `INFERENCE_API_KEY`
- `GITHUB_TOKEN`
- explicit `HOME` for launchd

The repository URL is derived from its `origin` remote rather than configured
again. `node`, `git`, `jj`, and `yx` are supplied through the package wrapper's
`PATH`, not environment variables. Secrets are injected through the existing
Nix secret-management mechanism. The Darwin service uses a launchd daemon with
an explicit user, working directory, keep-alive behavior, and separate logs.

Unknown task backends fail during module evaluation or worker startup rather
than silently falling back to `yx`.

## Failure Handling

- Dispatcher failure: Temporal resumes the singleton dispatcher and reconciles
  active workflows before admitting more work.
- Claim failure: the work-item workflow exits without affecting other tasks.
- Agent failure: release the task, clean the workspace, and record failure;
  do not automatically rerun the agent.
- PR creation failure: release the task and clean the workspace.
- PR closed without merge: release the task and finish the workflow.
- Worker restart: Temporal resumes each workflow from its recorded history.
- Invalid backend candidate: skip it and log a structured reason; do not
  mutate the task.

## Testing And Verification

The implementation should include:

- Unit tests for backend candidate ordering and invalid priority handling.
- Unit tests proving root metadata inheritance, deepest-first ordering, and
  final-root review gating.
- Dispatcher workflow tests for slot admission, reconciliation, and duplicate
  workflow IDs.
- Work-item workflow tests for claim, failure release, cancellation, review
  feedback, merge, and completion paths.
- Agent tests for tool allowlisting, cancellation, timeout, streaming tool
  calls, and bounded shell execution.
- Nix module evaluation tests for defaults, backend selection, environment
  wiring, and secret references.
- Build and test verification with `npm test`, `npm run build`, and Nix
  package/module evaluation.

## Deliberate Non-Goals

- Multiple task backends in one service instance.
- Automatic priority assignment or aging.
- Preempting an already-running agent for higher-priority work.
- Per-repository agent policy configuration.
- LiteLLM or Pi compatibility layers.
- A long-running polling Activity for pull-request review.
