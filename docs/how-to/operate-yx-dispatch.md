# Operate `yx` Dispatch

The dispatcher polls the repository's `yx` data and admits eligible tasks into
`WorkItemWorkflow` executions.

## Make a task eligible

Create or select a yak in `todo` state and add both required tags:

```sh
yx add "Implement the example" --state todo --context "Describe the task here"
yx tag add "Implement the example" @g2g @priority:100
```

The adapter reads `yx list --format json`. It recursively examines child yaks,
skips malformed priority tags, and returns review candidates before
implementation candidates. Higher priority wins within each class; creation
time and then ID break ties.

## Observe the dispatcher

Find the dispatcher workflow in the Temporal UI at
`http://127.0.0.1:8233`. Its workflow ID defaults to
`dispatcher-<URL-encoded repository root>` unless `DISPATCHER_WORKFLOW_ID` is
set.

The workflow's `state` query reports active, completed, and failed task IDs.
Each child work item exposes its own `state` query.

## Understand lifecycle mutations

When a candidate is admitted, the Activity runs `yx start`. When the current
implementation succeeds, it runs `yx done`; on failure it runs `yx state <id>
todo`. The release reason is retained in workflow failure state but is not
written back by the current `yx` adapter.

## Disable automatic dispatch

Set `DISPATCHER_ENABLED=false`. Direct inference workflows remain available;
the worker simply does not start the repository dispatcher.
