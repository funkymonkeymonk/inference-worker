# Yak Template

Use this template for every new implementation yak in this repository. The yak
name should be a concise imperative sentence. Add `@g2g` and a valid
`@priority:<integer>` tag when the yak is eligible for automatic dispatch.

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

- Keep one implementation outcome per yak; split work when acceptance criteria
  would require unrelated files or independent review.
- Put prerequisites below the work they block in the `yx` hierarchy.
- Keep Temporal workflows deterministic and backend-neutral. Put side effects,
  task-tool parsing, filesystem access, network calls, and process execution in
  Activities or adapters.
- Include tests in the same yak as the behavior they protect.
- Use `@priority:<integer>` only for explicit admission order; do not encode
  priority in workflow orchestration.
