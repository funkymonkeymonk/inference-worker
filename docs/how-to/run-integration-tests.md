# Run Integration Tests

Run unit tests and the TypeScript build without external services:

```sh
npm test
npm run build
```

The integration tests use a real Temporal server. Start the repository service
and run:

```sh
devenv up -d
npm run test:integration
```

This command runs the dispatcher and work-item tests serially. To point tests at
another Temporal server, set `INTEGRATION_TEMPORAL_ADDRESS` and optionally
`INTEGRATION_TEMPORAL_NAMESPACE`:

```sh
INTEGRATION_TEMPORAL_ADDRESS=127.0.0.1:7233 npm run test:integration
```

The worker end-to-end test starts a real compiled worker and requires `yx` in
`PATH`. Run it with:

```sh
npm run test:worker-integration
```

Or use the devenv task, which checks Temporal health and builds first:

```sh
devenv tasks run integration:worker-shaves-yak
```

The test creates a temporary tagged yak, verifies that the worker writes a
marker file through the agent tool, and removes the yak and marker during
cleanup.
