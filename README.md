# SysTwo

SysTwo is an open-source MCP server for safe, cost-aware delegation in agentic coding workflows.

It helps a high-value controller agent delegate bounded coding work to lower-cost runner providers while preserving review, permissions, traces, usage records, and temporary-worktree isolation.

> Status: design draft / pre-alpha. The V0 contracts below describe the intended public shape; implementation is in progress.

## Why SysTwo

AI coding workflows increasingly involve multiple agents, CLIs, APIs, and model providers. The hard problem is no longer only which model should answer a prompt. It is deciding which agent should do which part of a coding task, with which token budget, permission level, safety boundary, and review requirement.

SysTwo treats delegation as a first-class workflow primitive:

```text
High-value agent decides.
Lower-cost runner executes.
SysTwo enforces the boundary.
```

## What SysTwo Is

SysTwo is:

- An MCP server for coding-agent delegation.
- A token-value router for task steps, not just model calls.
- A policy layer for permissions and safety floors.
- A temporary-worktree execution boundary.
- A usage and evidence recorder.
- A provider-neutral adapter surface for runner agents.

SysTwo is not:

- A replacement for Codex, Claude Code, OpenCode, Aider, or other coding agents.
- A general multi-agent framework.
- A model gateway.
- An observability platform.
- An autonomous GitHub bot.

## Reference Workflow

```text
Controller agent
  -> SysTwo MCP server
    -> route task by value, risk, and permissions
    -> delegate bounded work to a runner provider
      -> create temporary git worktree
      -> search / edit / test / summarize logs
    -> return diff, evidence, trace, and usage
  -> Controller agent reviews and decides
```

For V0, the reference controller is Codex and the reference runner provider is CodeBuddy. They are examples, not hard requirements.

The long-term goal is for SysTwo to work with many controllers and runner providers:

```text
Controllers: Codex, Claude Code, OpenCode, custom MCP clients
Runners: CodeBuddy, Claude Code, OpenCode, Aider, local models, custom CLIs
```

## Demo Goal

The V0 demo should prove one thing:

> A high-value controller can safely outsource a failing-test fix to a lower-cost runner without giving up final control.

```text
1. A repo has a failing test.
2. The controller asks SysTwo for routing advice.
3. SysTwo recommends a bounded execution path.
4. The controller explicitly delegates the task.
5. A runner fixes the issue in a temporary worktree.
6. SysTwo returns a diff, test evidence, trace, and usage.
7. The controller reviews and decides whether to apply the result.
```

## Target Install

The intended V0 install flow is:

```bash
npm install -g systwo
systwo doctor
systwo mcp
```

The intended zero-config demo is:

```bash
npx systwo demo
```

The demo should run with a mock provider so new users can inspect the worktree-to-diff-to-review loop before connecting any real agent, API, or paid provider.

## MCP Tools

V0 exposes a small tool surface:

- `route_task`: returns routing advice only; it does not execute work.
- `delegate_task`: delegates a bounded task to a runner provider.
- `usage_report`: reports estimated usage and actual usage when available.

Task-specific behavior is represented through presets rather than a large public API:

- `summarize_codebase`
- `draft_changes`
- `fix_failures`

See [docs/V0_SPEC.md](docs/V0_SPEC.md) for the draft contracts.

## Safety Model

SysTwo's open-source credibility depends on its safety boundary. The safety floor must be enforced by code and covered by tests.

V0 hard safety floor:

- No edits to the main worktree.
- No commits, pushes, merges, tags, or releases.
- No automatic application of generated patches.
- No network access by default.
- No secret exfiltration.
- No destructive shell commands unless explicitly allowed by a future policy.
- All runner edits happen in temporary git worktrees.
- All edit-capable tasks return diff evidence.
- All test-capable tasks return test evidence or explain why tests were not run.

If a safety property cannot be enforced against an arbitrary provider CLI, SysTwo should document it as best-effort rather than pretending it is guaranteed.

See [SECURITY.md](SECURITY.md) for the current security posture and threat model.

## Project Docs

- [docs/V0_SPEC.md](docs/V0_SPEC.md): V0 product and technical specification.
- [SECURITY.md](SECURITY.md): security posture, threat model, and vulnerability reporting.
- [CONTRIBUTING.md](CONTRIBUTING.md): contribution guidelines.
- [docs/RESEARCH_NOTES.md](docs/RESEARCH_NOTES.md): positioning references and adjacent projects.

## V0 Roadmap

- TypeScript MCP server.
- Global npm install.
- `npx systwo demo` with mock provider.
- CodeBuddy reference provider.
- Temporary-worktree execution.
- `route_task`, `delegate_task`, `usage_report`.
- Presets for `summarize_codebase`, `draft_changes`, and `fix_failures`.
- Usage estimate before execution.
- Actual usage when providers expose it.
- Safety and threat model docs.
- Safety tests for main-worktree isolation.

## Contributing

SysTwo is early. Contributions that sharpen the safety boundary, provider adapter contract, tests, or documentation are especially welcome.

Before contributing, read [CONTRIBUTING.md](CONTRIBUTING.md) and keep changes scoped to the V0 safety model.

## License

MIT. See [LICENSE](LICENSE).
