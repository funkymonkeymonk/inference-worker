# Repository Agent Guidance

## New Yaks

Use [`docs/yak-template.md`](docs/yak-template.md) for every new yak. The
template is the required structure for implementation-ready work and keeps
scope, acceptance criteria, tests, dependencies, and non-goals explicit.

Yaks for this repository must follow the task-dispatch design in
[`docs/plans/2026-09-05-task-dispatch-design.md`](docs/plans/2026-09-05-task-dispatch-design.md):
Temporal workflows remain deterministic and backend-neutral; task-tool behavior
belongs in the configured backend adapter; and side effects belong in
Activities. Use the `yx` hierarchy to represent prerequisites and add `@g2g`
plus a valid `@priority:<integer>` tag only when a yak is ready for automatic
dispatch.
