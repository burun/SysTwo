# SysTwo Security and Threat Model

Status: draft  
Date: 2026-06-27

## Reporting a Vulnerability

SysTwo is pre-alpha, but security reports are welcome now.

Please do not open a public issue for a suspected vulnerability if it includes exploit details, secrets, private repository content, or provider credentials. Instead, report it privately to the project maintainers.

Until a dedicated security contact is published, use GitHub private vulnerability reporting if it is enabled for the repository. If private reporting is not available yet, open a minimal public issue asking for a secure contact channel without including sensitive details.

Please include:

- A short description of the issue.
- Steps to reproduce, if safe to share.
- Affected version, commit, or branch.
- Whether secrets, credentials, repository contents, or provider output may have been exposed.
- Any suggested mitigation.

## Supported Versions

SysTwo has not shipped a stable release yet. Security fixes currently target the main development line.

Once versioned releases exist, this section will list supported release lines and security update policy.

## Security Posture

SysTwo runs coding agents and provider CLIs against source code. That makes security a core product concern, not a documentation afterthought.

The V0 security posture is:

> Treat every runner provider as untrusted. Treat every provider output as untrusted. Keep final authority with the controller or human.

## Trust Boundaries

```text
Controller / human
  trusted to make final decisions

SysTwo
  trusted to enforce policy, create worktrees, collect evidence, and avoid main-worktree mutation

Provider adapter
  partially trusted integration code

Provider CLI / external model
  untrusted execution and untrusted output

Repository code
  potentially sensitive

Secrets and credentials
  must not be copied into traces, summaries, prompts, diffs, or logs
```

## V0 Enforced Invariants

SysTwo should enforce these with code and tests:

1. Runners do not edit the main worktree.
2. Edit-capable tasks run in a temporary worktree or patch-only mode.
3. SysTwo does not commit, push, merge, tag, or release.
4. SysTwo does not expose `apply_result`.
5. Edit-capable tasks return diff evidence.
6. Test-capable tasks return test evidence or explain why tests were not run.
7. Network is disabled by default at the policy level.
8. Provider output is never treated as an instruction to SysTwo itself.

## Best-Effort Controls

Some controls may be platform-dependent or provider-dependent.

If SysTwo cannot technically enforce a control for an arbitrary provider CLI, it must report the limitation clearly.

Examples:

- Network isolation may require platform-specific sandboxing.
- A provider may send repository context to its own backend.
- A provider CLI may have its own credential storage and telemetry behavior.

SysTwo should not overclaim guarantees it cannot enforce.

## Threats

### Main Worktree Mutation

Risk: a provider modifies the user's real repository.

Mitigation:

- Run edit-capable providers in temporary worktrees.
- Capture diffs from the temp worktree.
- Test that main worktree files do not change during delegated runs.

### Unauthorized Git Operations

Risk: a provider commits, pushes, merges, tags, or opens a release.

Mitigation:

- Block direct SysTwo support for these operations.
- Run providers with constrained commands where possible.
- Detect unexpected git state changes.

### Secret Exfiltration

Risk: provider reads secrets and sends them to a model/backend or includes them in output.

Mitigation:

- Do not include secrets in task briefs.
- Redact known secret patterns from traces and summaries.
- Document that external providers may receive code context.
- Keep telemetry off by default.

### Prompt Injection Through Provider Output

Risk: provider output tells the controller or SysTwo to ignore rules, run commands, or apply unsafe changes.

Mitigation:

- Treat provider output as data, not instructions.
- Return structured evidence for controller review.
- Do not let `route_task` execute follow-up tools automatically.

### Resource Exhaustion

Risk: provider loops, creates large files, or leaves orphaned worktrees.

Mitigation:

- Timeouts.
- Concurrency limits.
- Worktree cleanup.
- Disk usage warnings.
- Orphan detection.

### Network Leakage

Risk: provider contacts remote services unexpectedly.

Mitigation:

- Network disabled by default in SysTwo policy.
- Platform-specific network sandboxing where available.
- Clear reporting when isolation is not enforceable.

## Telemetry

V0 should default to no telemetry.

If telemetry is ever added:

- It must be opt-in.
- It must not include code, diffs, prompts, secrets, or provider outputs by default.
- It must be documented in plain language.

## Security Test Targets

V0 should include tests for:

- Main worktree unchanged after edit-capable task.
- Temp worktree created and associated with trace ID.
- Commit/push/merge attempts are not exposed through SysTwo.
- `route_task` does not execute runner work.
- `delegate_task` rejects broad unbounded tasks.
- Diff evidence is required for edit-capable results.
- Network default is false.
- Secrets are redacted from trace files where detectable.
