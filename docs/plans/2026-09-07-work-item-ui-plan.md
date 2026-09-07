# Work Item Monitoring UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a separate read-only local web server for live and historical work-item monitoring.

**Architecture:** Add a small `src/ui` module with injected Temporal and `yx` readers, a view-model aggregator, and a dependency-free HTTP server. Temporal and `yx` remain the source systems; the server keeps no durable state.

**Tech Stack:** TypeScript, Node.js built-in `http`, `@temporalio/client`, existing `tsx` test runner, and browser-native HTML/CSS/JavaScript.

### Task 1: Define UI reader contracts and view models

**Files:**
- Create: `src/ui/types.ts`
- Create: `src/ui/view-model.ts`
- Test: `src/ui/view-model.test.ts`

**Step 1: Write the failing test**

Test that active Temporal state and `yx` metadata map to one overview item,
that a missing `yx` record is marked unavailable, and that a workflow ID is
correlated as `work-item-${taskId}`.

**Step 2: Run the focused test**

Run: `npm test -- src/ui/view-model.test.ts`

Expected: FAIL because the UI types and aggregation functions do not exist.

**Step 3: Implement the minimal mapping**

Define injected reader interfaces and pure mapping functions. Keep response
objects JSON-safe and represent source errors as strings.

**Step 4: Run the focused test**

Run: `npm test -- src/ui/view-model.test.ts`

Expected: PASS.

### Task 2: Add read-only Temporal and yx adapters

**Files:**
- Create: `src/ui/temporal-reader.ts`
- Create: `src/ui/yx-reader.ts`
- Test: `src/ui/readers.test.ts`

**Step 1: Write failing tests**

Test Temporal workflow listing/query normalization and assert the `yx` runner
uses only `list --format json` and `context <id> --show`.

**Step 2: Run focused tests**

Run: `npm test -- src/ui/readers.test.ts`

Expected: FAIL because adapters do not exist.

**Step 3: Implement adapters**

Inject Temporal client operations and the existing command-runner shape. Avoid
calling any mutating `yx` command. Normalize malformed records into explicit
reader errors.

**Step 4: Run focused tests**

Run: `npm test -- src/ui/readers.test.ts`

Expected: PASS.

### Task 3: Add the read-only HTTP server and page

**Files:**
- Create: `src/ui/server.ts`
- Create: `src/ui/page.ts`
- Test: `src/ui/server.test.ts`

**Step 1: Write failing tests**

Test `GET /api/overview`, `GET /api/work-items/:id`, `GET /`, unknown paths,
and correct JSON content types.

**Step 2: Run focused tests**

Run: `npm test -- src/ui/server.test.ts`

Expected: FAIL because the server does not exist.

**Step 3: Implement minimal server**

Use Node's `http.createServer`, inject the overview/detail readers, and serve
a single page with periodic refresh and hash-based detail navigation. Bind
defaults to `127.0.0.1` and a configurable port.

**Step 4: Run focused tests**

Run: `npm test -- src/ui/server.test.ts`

Expected: PASS.

### Task 4: Wire the standalone UI command

**Files:**
- Create: `src/ui.ts`
- Modify: `package.json`
- Modify: `src/config.ts`
- Test: `src/config.test.ts`

**Step 1: Write the failing configuration test**

Test default host/port and environment overrides.

**Step 2: Run the focused test**

Run: `npm test -- src/config.test.ts`

Expected: FAIL for the new UI configuration fields.

**Step 3: Implement wiring**

Add `npm run ui`, create the Temporal client, construct read-only adapters,
start the server, and log its bound URL. Do not alter the worker startup.

**Step 4: Run focused tests**

Run: `npm test -- src/config.test.ts`

Expected: PASS.

### Task 5: Verify the complete change

**Files:**
- No new files.

**Step 1: Run all unit tests**

Run: `npm test`

Expected: PASS.

**Step 2: Build TypeScript**

Run: `npm run build`

Expected: PASS with `dist/ui.js` and UI modules emitted.

**Step 3: Inspect the worktree**

Run: `jj diff --stat` and `jj status`.

Expected: only the design, plan, UI, configuration, package, and test files
are changed.
