# Contributing to SysTwo

Thanks for helping make SysTwo safer and more useful.

SysTwo is currently a V0 release-candidate project. The most valuable contributions are ones that clarify the V0 safety boundary, strengthen tests, improve provider adapter contracts, or make the documentation more accurate.

## Ground Rules

- Keep the controller or human in final control.
- Do not add flows that commit, push, merge, tag, release, or apply generated patches to the main worktree.
- Treat provider output as untrusted data.
- Keep network access disabled by default.
- Prefer small, reviewable changes.
- Document best-effort security controls honestly.

## Good First Contributions

- Tighten wording in docs where guarantees are too broad.
- Add tests for main-worktree isolation.
- Improve task brief validation.
- Improve trace, usage, or diff evidence shape.
- Add mock-provider demo coverage.
- Document provider adapter expectations.

## Development Workflow

Use the V0 spec and implementation tests as the source of truth:

- [docs/V0_SPEC.md](docs/V0_SPEC.md)
- [SECURITY.md](SECURITY.md)
- [docs/PROVIDER_ADAPTERS.md](docs/PROVIDER_ADAPTERS.md)
- [docs/ROUTING_POLICY.md](docs/ROUTING_POLICY.md)
- [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md)

When code lands, contributions should include:

- A clear description of the behavior change.
- Tests for safety-sensitive behavior.
- Documentation updates for public contracts or configuration.
- Notes about provider-specific limitations.

## Security-Sensitive Changes

Changes touching worktrees, shell execution, network access, provider output handling, traces, secrets, or permissions should include tests and a short explanation of the threat being addressed.

Do not weaken the V0 safety floor through configuration or provider-specific exceptions.

## Reporting Vulnerabilities

Follow [SECURITY.md](SECURITY.md). Do not publish exploit details, secrets, credentials, private repository contents, or provider output in a public issue.
