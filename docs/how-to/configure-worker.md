# Configure the Worker

The worker is configured with environment variables. The nix-darwin module
maps its options to the same environment variables; see the
[configuration reference](../reference/configuration.md) for every value.

## Configure Temporal

```sh
export TEMPORAL_ADDRESS=127.0.0.1:7233
export TEMPORAL_NAMESPACE=inference
export TEMPORAL_TASK_QUEUE=inference-worker
```

The client uses the first three values when it connects and starts a workflow.

## Configure inference

Set the base URL of an OpenAI-compatible API. The Activity appends
`/chat/completions`, so a base URL ending in `/v1` is typical:

```sh
export INFERENCE_ENDPOINT=http://127.0.0.1:8081/v1
export INFERENCE_API_KEY=replace-me   # optional
```

The endpoint must return server-sent events and terminate the stream with
`data: [DONE]`. Direct inference expects text deltas; agent execution also
expects streamed OpenAI tool-call deltas.

## Configure dispatch

Dispatch is enabled by default and uses `yx`:

```sh
export TASK_BACKEND=yx
export REPOSITORY_ROOT=/path/to/repository
export DISPATCHER_ENABLED=true
export DISPATCHER_POLL_INTERVAL_MS=60000
export DISPATCHER_MAX_CONCURRENT_IMPLEMENTATIONS=1
export DISPATCHER_WORKFLOW_ID=dispatcher-for-this-repository
```

Only `yx` is accepted. A candidate must be in `todo` state, have `@g2g`, and
have a valid `@priority:<integer>` tag. The repository root is the working
directory for `yx` commands and the agent workspace.

To run only direct inference, disable the dispatcher:

```sh
DISPATCHER_ENABLED=false INFERENCE_ENDPOINT=http://127.0.0.1:8081/v1 npm start
```

## Configure agent execution

The worker's default policy is:

```text
model: omlx/qwen3.8-27b
allowed tools: read, write, edit, bash
maximum run time: 7200 seconds
```

Override the model or time limit with `AGENT_MODEL` and
`AGENT_MAX_RUN_TIME_SECONDS`. The `bash` tool is bounded to 30 seconds and its
output to 1 MiB. File tools reject paths outside `REPOSITORY_ROOT`.

## Use the nix-darwin module

The flake exports `darwinModules.inference-worker`. A host configuration can
enable it as follows:

```nix
services.inference-worker = {
  enable = true;
  repositoryRoot = "/Users/me/src/project";
  inference.endpoint = "http://127.0.0.1:8081/v1";
  dispatcher.maxConcurrentImplementations = 1;
};
```

The module runs a launchd user agent, sets its working directory to
`repositoryRoot`, and writes logs to `/tmp/inference-worker.log` and
`/tmp/inference-worker.error.log`.
