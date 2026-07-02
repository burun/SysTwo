# Routing Policy

Status: V0 release-candidate draft

SysTwo V0 uses a deterministic routing policy. It does not need a model call to decide whether a task should be delegated.

## Scope

SysTwo V0 routes bounded coding tasks only. It is not a generic router for any task Codex can imagine.

Delegate only when the task can be constrained with a concrete goal, permissions, allowed files or repo context, acceptance criteria, and reviewable evidence. Open-ended research, writing, browser automation, product planning, and general assistant work are outside V0.

## Policy Layers

```text
hardcoded safety floor
  -> user config
  -> repo config
  -> per-call constraints
```

Later layers may narrow behavior. They cannot weaken the safety floor.

## V0 Safety Floor

- `route_task` returns advice only.
- `delegate_task` must be called explicitly.
- `delegate_task` returns `delegatedUsageSummary` so the controller can include runner token allocation in its final response.
- Network is disabled by default.
- Main worktree edits are forbidden.
- Generated patches are never applied automatically.
- Commit, push, merge, tag, and release operations are outside V0.

## Preset Mapping

- `summary` or read-only goals -> `summarize_codebase`
- patch/change/edit goals -> `draft_changes`
- failing test/lint/fix goals -> `fix_failures`

The router returns a friction-adjusted recommendation:

- Read-only summaries usually get `answer_directly`, with `delegationValue=low` and `friction=none`.
- Bounded draft changes usually get `patch_only`, with `delegationValue=medium` and no temporary worktree.
- Failing-test fixes usually get `temp_worktree`, with `delegationValue=high` because isolated edits and test evidence justify the extra setup.

The router may recommend delegation, but it never invokes a provider internally.

`route_then_delegate` is a convenience wrapper around this policy. It invokes a provider only when the route is delegate-capable and `delegationValue=high`; otherwise it returns a non-delegated result with the routing rationale.
