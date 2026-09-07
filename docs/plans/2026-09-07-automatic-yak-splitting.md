# Automatic Yak Splitting Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stop implementation yaks at a configurable wall-clock limit, discard isolated work, and automatically create bounded child yaks from a model-generated failure plan.

**Architecture:** Keep Temporal workflows deterministic. A WorkItem Activity owns the isolated workspace and agent timeout. On failure, a backend Activity records the attempt and a separate planner Activity asks the configured inference endpoint for a structured child-yak plan. The backend adapter validates depth and child-count limits before creating yaks. All policy values are parsed once from environment configuration and passed through serializable Activity inputs.

**Tech Stack:** TypeScript, Temporal TypeScript SDK, OpenAI-compatible streaming inference, `yx`, `jj`, devenv.

## Policy Configuration

Add a validated configuration boundary used by worker Activities. Expose these environment variables with the listed defaults:

- `AGENT_MAX_RUN_TIME_SECONDS=7200` - maximum implementation Activity wall-clock time.
- `AGENT_BASH_TIMEOUT_MS=3600000` - default shell tool timeout.
- `AGENT_MAX_OUTPUT_TOKENS=16384` - per-model-turn output budget.
- `DISPATCHER_MAX_YAK_DEPTH=10` - maximum absolute depth from the root yak.
- `DISPATCHER_MAX_SPLIT_CHILDREN=5` - maximum children created for one failed yak.
- `DISPATCHER_SPLIT_ENABLED=true` - enable automatic planning and splitting.
- `DISPATCHER_PLANNER_MODEL` - defaults to `AGENT_MODEL`.
- `DISPATCHER_PLANNER_MAX_RUN_TIME_SECONDS=600` - planner Activity limit.
- `DISPATCHER_PLANNER_MAX_OUTPUT_TOKENS=4096` - planner response budget.

Reject non-positive, non-integer, or unsafe values at worker startup. Preserve explicit environment overrides in devenv and Nix service configuration.

## Task 1: Define Contracts And Configuration

**Files:** `src/types.ts`, `src/config.ts`, `src/config.test.ts`, `src/task-contracts.test.ts`.

1. Write failing tests for defaults, overrides, invalid values, planner policy, and serializable split proposals.
2. Implement typed configuration parsing and `SplitProposal`/`SplitPlan` contracts.
3. Run `npx tsx --test src/config.test.ts src/task-contracts.test.ts`.

## Task 2: Isolate And Discard Workspaces

**Files:** `src/activities/workspace.ts`, `src/activities/workspace.test.ts`, `src/activities/index.ts`, `src/workflows/work-item.ts`.

1. Write failing tests proving workspace creation is isolated and cleanup removes it on success, failure, cancellation, and timeout.
2. Implement workspace Activities using repository-root `jj` workspaces or temporary directories, with idempotent cleanup.
3. Pass the workspace path into `executeAgent`; never give the agent the repository root directly.
4. Run focused workspace and WorkItem tests.

## Task 3: Enforce The Two-Hour WorkItem Limit

**Files:** `src/workflows/work-item.ts`, `src/workflows/work-item.test.ts`, `src/activities/execute-agent.ts`, `src/activities/execute-agent.test.ts`.

1. Add a failing workflow test for the configured wall-clock timeout and cancellation cleanup.
2. Set Activity start-to-close and workflow timeout values from configuration while retaining one Activity attempt.
3. Ensure timeout errors are recorded as failure reasons and do not leave the workspace behind.
4. Run the focused workflow and Activity tests.

## Task 4: Add Planner Activity

**Files:** `src/activities/plan-yak-split.ts`, `src/activities/plan-yak-split.test.ts`, `src/activities/index.ts`, `src/types.ts`.

1. Write failing tests for structured planner output, malformed output, empty plans, planner timeout, and planner cancellation.
2. Implement a no-tools, read-only planner request to the OpenAI-compatible endpoint. Include only yak context, failure reason, current root depth, remaining depth, and child-count limit.
3. Require strict JSON proposals containing imperative name, goal, scope, acceptance criteria, tests, dependencies, and non-goals.
4. Reject proposals that exceed configured count/depth or omit required sections.
5. Run planner tests with a fake streaming endpoint.

## Task 5: Create Bounded Yak Children

**Files:** `src/types.ts`, `src/backends/yx.ts`, `src/backends/yx.test.ts`, `src/activities/task-backend.ts`, `src/activities/index.ts`.

1. Write failing tests for root-depth calculation, maximum depth rejection, child-count limits, idempotent split records, context history, blocking tags, and child creation commands.
2. Add a backend operation that appends the failure attempt, adds `@implementation-failed`, and creates validated child yaks under the failed yak.
3. Store a split marker in the parent context so a repeated Activity does not duplicate children.
4. Keep the parent blocked until all generated children are terminal; independent siblings remain dispatchable.
5. Run focused adapter and Activity tests.

## Task 6: Wire Dispatcher Failure Splitting

**Files:** `src/workflows/dispatcher.ts`, `src/workflows/dispatcher.test.ts`, `src/activities/task-backend.ts`.

1. Write failing workflow tests for timeout failure, planner failure, split-disabled mode, maximum depth, and continuing to independent candidates.
2. Add planner and split Activities to the controlled child failure path after `recordTaskFailure`.
3. Make planner failure leave the original yak blocked with the failure reason and never fail the dispatcher itself.
4. Preserve one child attempt, no automatic retries, and durable failure state.
5. Run focused dispatcher tests.

## Task 7: Expose Environment Configuration

**Files:** `devenv.nix`, `nix/module.nix`, `src/worker.ts`, configuration tests.

1. Add failing evaluation/configuration tests for every environment variable and default.
2. Wire the values through devenv and launchd without hard-coding them in workflows.
3. Validate configuration during worker startup and print safe effective values in startup diagnostics.
4. Run `npm test`, `npm run build`, devenv evaluation, and Nix module checks.

## Task 8: End-To-End Verification

**Files:** `integration/dispatcher.test.ts`, `integration/work-item.test.ts`, `integration/worker-shaves-yak.test.ts`.

1. Add a slow-agent integration fixture that exceeds a short test timeout, verifies workspace discard, records the failure, and creates bounded child yaks.
2. Verify a child at maximum depth is blocked for human review rather than split again.
3. Verify an independent yak is admitted after a failed parent is split.
4. Run the integration suite and document the exact monitoring and unblock commands.

### Monitoring And Unblocking

Inspect the parent, failure history, and generated children with:

```bash
yx list --format json
yx context <parent-yak-id> --show
temporal workflow show --workflow-id <dispatcher-workflow-id>
```

After human review, remove the failure block and return the yak to the queue:

```bash
yx tag remove <yak-id> @implementation-failed
yx state <yak-id> todo
```

Terminate a stale test or development dispatcher with:

```bash
temporal workflow terminate --workflow-id <dispatcher-workflow-id>
```

## Verification

Run, in order:

```bash
npm test
npm run build
npm run test:integration
devenv eval processes.worker.exec
```

Do not dispatch the original broad integration yak until the focused implementation children are terminal. Each child must include its own test evidence and remain below the configured root-depth limit.
