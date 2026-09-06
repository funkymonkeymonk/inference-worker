# Current Implementation Status

This page distinguishes shipped behavior from the broader task-dispatch design
document in `docs/plans/2026-09-05-task-dispatch-design.md`.

## Implemented

- TypeScript build and Node.js ESM worker.
- Temporal namespace, task queue, worker capacity, graceful shutdown, and client configuration.
- Direct streaming OpenAI-compatible inference with optional bearer authentication, usage parsing, heartbeats, cancellation, and timeout handling.
- Request-type model routing for `fast`, `reasoning`, and `agent`.
- A custom streaming coding-agent Activity with `read`, `write`, `edit`, and bounded `bash` tools.
- Backend-neutral task contracts and a concrete `yx` adapter.
- `yx` candidate filtering by `todo`, `@g2g`, and valid priority, with review-first ordering.
- Dispatcher claim, child workflow execution, success completion, and failure release.
- Devenv Temporal service, development tasks, Nix package, and nix-darwin launchd module.
- Unit tests for inference, agent tools, backend behavior, and workflow contracts, plus Temporal integration tests.

## Present but not wired into the current work-item path

- `executePiTask` provides a Pi session Activity and is exported from the Activity registry.
- `TaskBackend.getContext` and `attachPullRequest` exist in the contract and adapter.
- `WorkItemState` includes review, merge, release, and pull-request fields.

## Not implemented despite appearing in the design

- Isolated `jj` workspace creation and cleanup.
- Draft pull-request creation or updates.
- Pull-request polling, review feedback, merge, and review-round handling.
- Cancellation or `wont-do` signals that release tasks.
- Backend synchronization beyond the current claim, release, and done commands.
- Multiple task backends or per-repository agent policy configuration.
- Nix secret injection and packaging of external `yx` or `jj` binaries.

## Operational implications

The current dispatcher marks a backend task done after `WorkItemWorkflow`
returns. That means `done` currently means the agent Activity completed, not that
a pull request was reviewed or merged. Configure the worker accordingly and do
not treat the current work-item workflow as a complete pull-request lifecycle.

The most complete end-to-end verification is
`npm run test:worker-integration`, which uses a temporary `yx` task and a local
streaming inference fixture. It does not verify pull-request behavior because
that behavior is not implemented.
