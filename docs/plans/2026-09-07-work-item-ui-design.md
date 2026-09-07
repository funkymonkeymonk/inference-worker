# Work Item Monitoring UI Design

## Goal

Provide a local, read-only web UI for monitoring active work-item
implementations and reviewing their historical Temporal execution data.

## Scope

The first release is an operator debugging surface, not a task-management
system. It displays existing data only: Temporal workflow state and history,
`yx` task metadata and context, dispatcher state, failures, and pull-request
links. It does not add agent instrumentation, mutation controls,
authentication, durable UI storage, or a frontend framework.

## Architecture

The UI runs as a separate local process so worker execution and HTTP lifecycle
remain independent. It binds to `127.0.0.1` by default and connects to the
configured Temporal namespace and task queue. A read-only `yx` adapter invokes
`yx list --format json` and `yx context <id> --show`.

The server exposes `GET /api/overview`, `GET /api/work-items/:id`, and `GET /`.
Temporal remains the source of execution history; `yx` remains the source of
task metadata. The browser is a dependency-free HTML page with a small module
script and periodic refresh. Partial source failures are represented in the
response rather than causing the entire page to fail.

## Data Flow

The overview reader lists work-item and dispatcher executions, queries active
workflow state, reads relevant `yx` records, and maps them to UI view models.
The detail reader combines one task's `yx` context with its correlated
`work-item-${taskId}` workflow execution and history. Correlation uses the
existing stable workflow ID convention. Missing counterparts are explicitly
reported as unavailable.

## Verification

Unit tests cover view-model mapping, partial Temporal/`yx` failures, workflow
correlation, and read-only `yx` command arguments. HTTP tests cover the API
shapes and static page. Existing tests plus `npm run build` are required.
