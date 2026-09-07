# Repository Agent Guidance

## New Yaks

Use [`docs/yak-template.md`](docs/yak-template.md) for every new yak. The
template is required and keeps scope, acceptance criteria, tests, dependencies,
and non-goals explicit.
Use [`docs/yak-quality-criteria.md`](docs/yak-quality-criteria.md) when sizing,
splitting, or reviewing implementation yaks.

Create one root yak for each coherent body of work. The root is a review-only
final check for documentation, specification completeness, code quality,
organization, and tests. Put implementation work in child yaks:

```sh
root=$(yx add "Review <body of work>" --format ids)
yx add "Implement <small outcome>" --under "$root"
```

The root owns the dispatch tags:

- Add `@g2g` to the root only when the entire tree is ready for automatic work.
- Add one valid `@priority:<integer>` tag to the root only.
- Never copy either tag onto descendants; descendants inherit root eligibility.
- The root final review becomes eligible only after all descendants are terminal.
- At equal root priority, deeper descendants are dispatched before shallower
  descendants.

Yaks for this repository must follow the task-dispatch design in
[`docs/plans/2026-09-05-task-dispatch-design.md`](docs/plans/2026-09-05-task-dispatch-design.md):
Temporal workflows remain deterministic and backend-neutral; task-tool behavior
belongs in the configured backend adapter; and side effects belong in
Activities. Use the `yx` hierarchy to represent prerequisites. Update the root
context and tags before dispatch; do not encode task-tool behavior or priority
rules in workflow code.
