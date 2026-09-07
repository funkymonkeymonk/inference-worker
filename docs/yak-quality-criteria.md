# Yak Quality Criteria

This guide defines the standard for yaks that humans can review and agents can
execute reliably. It applies to every implementation child yak in this
repository.

## What Makes A Good Yak

A good implementation yak has one independently testable outcome. It is small
enough that an agent can understand the scope, make the change, and verify it
without inventing architecture or decomposing the task itself.

Every implementation yak should:

- Describe one observable user or system outcome.
- Name the cohesive component and exact files or interfaces involved.
- Have three to seven binary acceptance criteria.
- Name the tests and verification commands required.
- State explicit non-goals for adjacent work.
- Identify prerequisite yaks and external setup.
- Expect a concrete code, test, configuration, or documentation change.
- Usually complete within roughly 30 minutes of agent time.
- Usually have a focused verification command that completes within five minutes.
- Leave the repository in a buildable, testable state.

Split a yak when its acceptance criteria involve unrelated files, different
owners, separate failure modes, or independent review decisions. Do not make
the agent discover the breakdown during execution.

## Agent-Ready Prompt

Use the required sections from `docs/yak-template.md`:

- Goal: one or two sentences describing the outcome.
- Scope: exact included components, files, interfaces, and behavior.
- Implementation: the chosen design and repository constraints.
- Acceptance Criteria: observable and binary completion checks.
- Tests: named test files and commands.
- Dependencies: prerequisite yaks and external setup.
- Non-Goals: explicitly excluded adjacent work.

The prompt should answer these questions without repository-wide exploration:

- What should change?
- Where should it change?
- What must remain unchanged?
- How will completion be proved?
- What should happen on failure, cancellation, retry, or restart?

## Sizing Rules

Prefer one of these shapes:

- One pure contract or data-model change with serialization tests.
- One workflow behavior with workflow tests.
- One Activity or adapter behavior with unit tests.
- One worker configuration boundary with startup tests.
- One Nix or devenv integration surface with evaluation tests.
- One focused end-to-end verification scenario.

Avoid combining these in one yak:

- Worker code, Nix packaging, and launchd configuration.
- Backend parsing, workflow orchestration, and agent behavior.
- Multiple lifecycle phases such as claim, workspace, PR, review, and merge.
- Production implementation and broad repository verification.
- Several independent configuration sources or service managers.

## Dependency Rules

Represent prerequisites explicitly in the yak hierarchy. A task that consumes
an unfinished interface belongs below the task that defines that interface.
Do not rely on prose dependencies alone.

Before dispatching a parent-level integration yak, verify that its prerequisite
children are terminal. If the backend cannot enforce that rule for ordinary
descendants, keep integration work in a separate review or verification stage
until the prerequisite children are complete.

At equal root priority, deeper implementation yaks should be dispatched before
their shallower integration parents. A parent must not duplicate the work of
unfinished descendants.

## Definition Of Done

A yak is complete only when:

- Its acceptance criteria are all true.
- Its focused tests pass.
- The required build or evaluation command passes.
- No unrelated behavior was added.
- The context records important verification evidence.
- Any follow-up is represented as a separate yak rather than hidden in the
  completion note.

For a failed implementation, the dispatcher appends the failure reason to the
yak context, adds `@implementation-failed`, and releases it to `todo`. The yak
and its descendants remain blocked until the underlying issue is fixed and the
tag is removed.
