# Inference Worker Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a TypeScript Temporal worker that executes durable inference tasks through Pi and a configured OpenAI-compatible endpoint, then expose it as a Nix-consumable Darwin service.

**Architecture:** Temporal Workflows own deterministic orchestration and request-type model policy. Activities own Pi, HTTP, filesystem, and process side effects. The Nix module supervises only the worker and supplies the opaque inference endpoint, which will be Bifrost in production.

**Tech Stack:** TypeScript, Temporal TypeScript SDK, Pi coding agent, Node.js, Devenv, Nix flakes, nix-darwin launchd.

### Task 1: TypeScript project foundation

**Files:**
- Create: `package.json`, `tsconfig.json`, `src/types.ts`
- Modify: `devenv.nix`

Add the Temporal SDK, Pi, Node typings, TypeScript, and test tooling. Define serializable request/result types without infrastructure-specific model defaults.

Verify with `npm install` and `npm run build`.

### Task 2: Deterministic inference workflow

**Files:**
- Create: `src/workflows/inference.ts`, `src/policy/model-routing.ts`
- Test: `src/workflows/inference.test.ts`

Create `InferenceWorkflow` with request-type routing and proxied Activities. Keep model policy in workflow code and keep the endpoint out of workflow input. Test routing and serialized result behavior with Temporal’s workflow test environment.

### Task 3: Bifrost inference Activity

**Files:**
- Create: `src/activities/execute-inference.ts`, `src/activities/index.ts`
- Test: `src/activities/execute-inference.test.ts`

Implement streaming HTTP to the configured OpenAI-compatible endpoint, final-result accumulation, Temporal heartbeats, cancellation propagation, bounded timeouts, and structured usage metadata. Do not persist token chunks in Temporal history.

### Task 4: Temporal worker and client

**Files:**
- Create: `src/worker.ts`, `src/client.ts`
- Modify: `devenv.nix`

Register workflows and Activities, configure one Activity slot by default, add graceful shutdown, and provide commands to start the worker and submit a test workflow.

### Task 5: Pi Activity harness

**Files:**
- Create: `src/activities/execute-pi.ts`
- Test: `src/activities/execute-pi.test.ts`

Run Pi inside an Activity with a task-scoped session, explicit workspace path, progress heartbeats, cancellation cleanup, and no automatic retry for mutating work. Return a compact structured result.

### Task 6: Nix flake outputs and Darwin module

**Files:**
- Modify: `flake.nix`, `devenv.nix`
- Create: `nix/module.nix`

Expose the worker package, executable, development shell, and Darwin module. The module accepts Temporal settings, task queue, worker capacity, and only the opaque inference endpoint. It must not define models, oMLX, Bifrost, context, or quantization settings.

### Task 7: Consume from `funkymonkeymonk/nix`

**Files:**
- Modify: `/Users/monkey/src/funkymonkeymonk/nix/flake.nix`, host configuration, and tests

Add the worker repository as a flake input, import its Darwin module, and configure the endpoint as Bifrost’s OpenAI API. Add evaluation coverage for the endpoint, task queue, and default serialized capacity.

### Task 8: Validation and repository publication

Run `npm test`, `npm run build`, `devenv tasks run check:lint`, and Nix evaluation/build checks. Commit with JJ, create the GitHub repository if needed, push a bookmark, and open a PR. Validate one local workflow against Bifrost before considering capacity two.
