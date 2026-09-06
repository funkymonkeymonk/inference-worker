# Run the Worker Locally

This tutorial starts a local Temporal server, builds the worker, and submits a
direct inference request through the included client.

## Prerequisites

You need Node.js, npm, and an OpenAI-compatible inference endpoint that supports
streaming chat completions. The repository's devenv supplies Node.js and the
Temporal CLI and starts a local Temporal service.

## Start Temporal

From the repository root:

```sh
devenv up -d
```

The devenv uses Temporal at `127.0.0.1:7233`, namespace `inference`, and UI
address `http://127.0.0.1:8233`.

Check the frontend before continuing:

```sh
devenv tasks run temporal:health
```

## Install and build

```sh
npm install
npm run build
```

## Start the worker

Set the endpoint and start the worker:

```sh
INFERENCE_ENDPOINT=http://127.0.0.1:8081/v1 npm start
```

The worker registers `InferenceWorkflow`, `WorkItemWorkflow`, and
`WorkDispatcherWorkflow`. Unless disabled, it also starts a dispatcher workflow
for `REPOSITORY_ROOT`.

## Submit a request

In a second shell:

```sh
INFERENCE_ENDPOINT=http://127.0.0.1:8081/v1 npm run client -- "Say hello."
```

The client prints a JSON result containing `text`, the selected model, and
optional token usage. The client sends a `fast` request with one user message.

## Stop the worker

Stop the worker with `Ctrl-C`. Stop the local Temporal service using the same
devenv process-management command you use for the rest of your local devenv
services.

For non-default Temporal settings or task dispatch, use the
[configuration guide](../how-to/configure-worker.md).
