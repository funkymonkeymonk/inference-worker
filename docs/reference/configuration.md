# Configuration Reference

## Environment variables

| Variable | Default | Used by | Meaning |
| --- | --- | --- | --- |
| `TEMPORAL_ADDRESS` | `127.0.0.1:7233` | worker, client | Temporal frontend address |
| `TEMPORAL_NAMESPACE` | `inference` | worker, client | Temporal namespace |
| `TEMPORAL_TASK_QUEUE` | `inference-worker` | worker, client | Temporal task queue |
| `REPOSITORY_ROOT` | current directory | worker, backend | Repository and agent workspace |
| `TASK_BACKEND` | `yx` | worker, Activities | Task adapter; only `yx` is supported |
| `INFERENCE_ENDPOINT` | none | inference and agent Activities | OpenAI-compatible API base URL |
| `INFERENCE_API_KEY` | none | inference and agent Activities | Optional bearer token |
| `WORKER_ACTIVITY_SLOTS` | `1` | worker | Maximum concurrent Activity task executions |
| `DISPATCHER_ENABLED` | enabled | worker | Set to `false` to skip dispatcher startup |
| `DISPATCHER_WORKFLOW_ID` | derived from repository root | worker | Singleton dispatcher workflow ID |
| `DISPATCHER_POLL_INTERVAL_MS` | `60000` | worker | Dispatcher polling interval |
| `DISPATCHER_MAX_CONCURRENT_IMPLEMENTATIONS` | `1` | worker | Dispatcher admission capacity |
| `AGENT_MODEL` | `omlx/qwen3.8-27b` | task backend | Model put into new work-item policy |
| `AGENT_MAX_RUN_TIME_SECONDS` | `7200` | task backend | Agent wall-clock limit |

`INFERENCE_ENDPOINT` is required only when an inference or agent Activity runs.
The endpoint is normalized by removing trailing slashes and appending
`/chat/completions`.

## Nix module options

The flake exports `darwinModules.inference-worker` with these options:

| Option | Default |
| --- | --- |
| `services.inference-worker.enable` | `false` |
| `services.inference-worker.package` | flake package |
| `services.inference-worker.temporal.address` | `127.0.0.1:7233` |
| `services.inference-worker.temporal.namespace` | `inference` |
| `services.inference-worker.taskQueue` | `inference-worker` |
| `services.inference-worker.repositoryRoot` | required |
| `services.inference-worker.taskBackend` | `yx` |
| `services.inference-worker.dispatcher.enable` | `true` |
| `services.inference-worker.dispatcher.pollIntervalMs` | `60000` |
| `services.inference-worker.dispatcher.maxConcurrentImplementations` | `1` |
| `services.inference-worker.inference.endpoint` | required |
| `services.inference-worker.maxConcurrentActivities` | `1` |
| `services.inference-worker.home` | `/var/empty` |

The module passes process configuration to a launchd user agent. It does not
configure a model server, credentials, or `yx` installation.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run build` | Compile `src` into `dist` |
| `npm start` | Run the compiled worker |
| `npm run dev` | Run the worker through `tsx` |
| `npm run client -- "..."` | Submit a direct `fast` workflow |
| `npm test` | Run source unit tests |
| `npm run test:integration` | Run Temporal integration tests |
| `npm run test:worker-integration` | Run real worker plus `yx` integration test |
