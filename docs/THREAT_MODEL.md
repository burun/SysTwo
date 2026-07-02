# Threat Model

Status: V0 release-candidate draft

The canonical security posture is maintained in [SECURITY.md](../SECURITY.md). This file exists as the implementation-facing threat model index for V0.

## V0 Release Gates

- Main worktree remains unchanged after edit-capable delegated work.
- Temporary worktrees are used for edit-capable work.
- `route_task` cannot execute runner work.
- `delegate_task` rejects operations outside the V0 safety floor.
- Edit-capable results require diff evidence.
- Test-capable results require test evidence or an explicit not-run explanation.
- Network default is false.
- Obvious secrets are redacted from trace files on a best-effort basis.

## Best-Effort Controls

Network isolation and provider telemetry can be platform- and provider-dependent. SysTwo V0 reports those limitations rather than claiming a guarantee it cannot enforce for arbitrary external CLIs.
