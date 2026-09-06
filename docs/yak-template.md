# Yak Template

Use this template for every new yak in this repository. The yak name should be
a concise imperative sentence. Every yak must have the sections below, even if
the answer is `None`.

## Root Yak

Create one root yak for a coherent body of work. The root is a review-only
final check, not an implementation task. Its context must explain how to verify
that the documentation, complete specification, code organization, tests, and
acceptance criteria are finished. Put `@g2g` and a valid `@priority:<integer>`
on the root only when the complete tree is ready for automatic dispatch.

## Child Yak

Put implementation work below the root using `yx add --under`. Children inherit
the root's `@g2g` and `@priority` tags; do not add those tags to children. A
child should describe one independently testable outcome. Use the hierarchy to
represent prerequisites: deeper children are dispatched before shallower
children at the same root priority.

```markdown
# Goal

State the user-visible or system-level outcome in one or two sentences.

# Scope

List the exact components, files, interfaces, and behavior included.

# Implementation

Describe the design constraints and the concrete implementation approach.
Reference the relevant design document and preserve backend-neutral workflow
boundaries.

# Acceptance Criteria

- State observable behavior that must be true when the yak is complete.
- Include failure, cancellation, retry, and determinism requirements when relevant.
- Identify compatibility or configuration constraints.

# Tests

- Name the unit, workflow, integration, evaluation, or build checks required.
- Include the command or test location when known.

# Dependencies

- List prerequisite yaks, interfaces, migrations, or external setup.
- Say `None` when the yak is independently implementable.

# Non-Goals

- Explicitly exclude adjacent work that belongs in another yak.
```

## Yak Creation Rules

- Keep one implementation outcome per child yak; split work when acceptance
  criteria would require unrelated files or independent review.
- Use the root only for final review. Do not put implementation work directly
  on the root.
- Put prerequisites below the work they block in the `yx` hierarchy.
- Keep Temporal workflows deterministic and backend-neutral. Put side effects,
  task-tool parsing, filesystem access, network calls, and process execution in
  Activities or adapters.
- Include tests in the same yak as the behavior they protect.
- Add `@g2g` and `@priority:<integer>` to the root only. These tags apply to the
  whole tree and define its admission order.
- Do not add `@g2g` or `@priority` to descendants.
- The root final review is eligible only after every descendant is terminal.
- Use `yx list --only not-done --tag g2g` to find dispatchable trees and
  `yx show <root> --format json` to inspect inherited work.
