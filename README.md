# Inference Worker

This repository contains a TypeScript Temporal worker for direct inference and
automatic `yx` task dispatch. It can run in a devenv during development or as a
Nix-built nix-darwin user agent.

The documentation describes the implementation in this checkout. Start with
the [documentation guide](docs/README.md).

## Quick start

```sh
devenv up -d
npm install
npm run build
INFERENCE_ENDPOINT=http://127.0.0.1:8081/v1 npm start
```

In another shell, submit a direct inference request:

```sh
INFERENCE_ENDPOINT=http://127.0.0.1:8081/v1 npm run client -- "Say hello."
```

The endpoint must expose an OpenAI-compatible streaming
`POST /chat/completions` API. The worker defaults to Temporal address
`127.0.0.1:7233`, namespace `inference`, and task queue `inference-worker`.

## Development commands

```sh
npm run build
npm test
npm run test:integration
npm run test:worker-integration
```

Integration tests require a reachable Temporal server. The worker integration
test also requires the `yx` command.
