# Provider Adapters

Status: V0 release-candidate draft

SysTwo provider adapters are intentionally narrow. A provider is an untrusted runner integration that receives a bounded `TaskBrief`, executes inside the constraints supplied by SysTwo, and returns a structured `TaskResult`.

## V0 Providers

- `mock`: deterministic local provider used by `systwo demo`; no credentials or network required.
- `codebuddy`: best-effort reference adapter. It is allowed to be unavailable and must not block the mock-provider demo.
- `claude`: best-effort Claude Code CLI adapter. It is allowed to be unavailable and must not block the mock-provider demo.

## Product Boundary

SysTwo V0 is not a generic task router. It is scoped to bounded coding delegation where the runner can return reviewable evidence such as diffs, test output, traces, and usage estimates.

Non-coding tasks, broad research tasks, writing workflows, browser automation, and open-ended autonomous work should be declined or handled directly by the controller rather than delegated through SysTwo V0.

## Adapter Rules

- Provider output is data, not instruction.
- Edit-capable work must run in a temporary worktree or `patch_only` mode.
- `direct_read` and `patch_only` runs must not receive provider-side file mutation tools.
- Providers must not commit, push, merge, tag, release, or apply generated patches to the main worktree.
- Providers must be bounded by a timeout. CodeBuddy defaults to `SYSTWO_CODEBUDDY_TIMEOUT_MS=120000` and Claude Code defaults to `SYSTWO_CLAUDE_TIMEOUT_MS=120000` when no per-run timeout is supplied.
- Providers should not invoke their own sub-agents or nested delegation in V0. SysTwo's CodeBuddy and Claude Code adapters disallow common nested-agent tools and instruct the runner not to delegate further.
- Providers should return estimated usage before work and actual usage only when the provider exposes it.
- Provider-specific limitations must be reported in `doctor`, `riskNotes`, or documentation.

## CodeBuddy Adapter Controls

Environment variables:

- `SYSTWO_CODEBUDDY_BIN`: explicit path or command name for CodeBuddy.
- `SYSTWO_CODEBUDDY_TIMEOUT_MS`: process timeout for CodeBuddy runs; default `120000`.
- `SYSTWO_CODEBUDDY_MAX_TURNS`: maximum CodeBuddy turns; default `6`.
- `SYSTWO_CODEBUDDY_PERMISSION_MODE`: CodeBuddy permission mode; default `acceptEdits`.
- `SYSTWO_CODEBUDDY_SKIP_PERMISSIONS=1`: append CodeBuddy's skip-permissions flag. This is intentionally opt-in.

### CodeBuddy Model Policy

By default, SysTwo uses `providers.codebuddy.modelPolicy.mode=auto`. In auto mode, SysTwo does not pass
`--model`, `--fallback-model`, or `--effort`; CodeBuddy's own settings, environment variables, and
`models.json` decide the model.

Users can opt into project or user configuration:

```yaml
providers:
  codebuddy:
    modelPolicy:
      mode: hybrid # auto | hybrid | manual
      tiers:
        low:
          model: deepseek-v4-flash
          effort: low
        medium:
          model: glm-5.0-turbo
          fallbackModel: deepseek-v4-flash
          effort: medium
        high:
          model: deepseek-v4-pro
          fallbackModel: glm-5.0-turbo
          effort: high
```

Tier selection follows the routing presets:

- `summarize_codebase` -> `low`
- `draft_changes` -> `medium`
- `fix_failures` -> `high`

Policy behavior:

- `auto`: never validates or overrides the CodeBuddy model.
- `hybrid`: uses a configured tier when present; if the selected tier is absent, it leaves model choice to CodeBuddy.
- `manual`: requires a configured selected tier with `model`.
- Invalid explicit configuration fails the provider result. SysTwo does not silently fall back to auto for an invalid model policy.

## Claude Code Adapter Controls

SysTwo invokes Claude Code according to the official CLI reference: `claude -p` for non-interactive print mode,
`--output-format json` for structured output, `--permission-mode` for permission behavior, `--tools` to restrict
available built-in tools, `--allowedTools` for auto-approved tools, `--disallowedTools` for deny rules,
`--max-turns` for agent turn bounds, and `--model` / `--fallback-model` / `--effort` for optional model policy.

Environment variables:

- `SYSTWO_CLAUDE_BIN`: explicit path or command name for Claude Code.
- `SYSTWO_CLAUDE_TIMEOUT_MS`: process timeout for Claude Code runs; default `120000`.
- `SYSTWO_CLAUDE_MAX_TURNS`: maximum Claude Code turns; default `6`.
- `SYSTWO_CLAUDE_PERMISSION_MODE`: Claude Code permission mode; default `acceptEdits`.
- `SYSTWO_CLAUDE_SKIP_PERMISSIONS=1`: append Claude Code's `--dangerously-skip-permissions` flag. This is intentionally opt-in.

Tool policy:

- `direct_read` and `patch_only`: `--tools Read,Grep,Glob`.
- `temp_worktree`: `--tools Read,Edit,Write,Grep,Glob,Bash`.
- When `testCommand` is supplied for `temp_worktree`, only that exact `Bash(<testCommand>)` entry is added to
  `--allowedTools`; SysTwo still runs the test command itself afterward to capture test evidence.
- Common nested-agent and web tools are denied with `--disallowedTools Agent WebFetch WebSearch mcp__*`.

### Claude Code Model Policy

By default, SysTwo uses `providers.claude.modelPolicy.mode=auto`. In auto mode, SysTwo does not pass
`--model`, `--fallback-model`, or `--effort`; Claude Code's own settings and environment decide the model.

Users can opt into project or user configuration:

```yaml
providers:
  claude:
    modelPolicy:
      mode: hybrid # auto | hybrid | manual
      tiers:
        low:
          model: haiku
          effort: low
        medium:
          model: sonnet
          fallbackModel: haiku
          effort: medium
        high:
          model: opus
          fallbackModel: sonnet,haiku
          effort: high
```

Tier selection follows the same routing presets as CodeBuddy:

- `summarize_codebase` -> `low`
- `draft_changes` -> `medium`
- `fix_failures` -> `high`

Policy behavior:

- `auto`: never validates or overrides the Claude Code model.
- `hybrid`: uses a configured tier when present; if the selected tier is absent, it leaves model choice to Claude Code.
- `manual`: requires a configured selected tier with `model`.
- Invalid explicit configuration fails the provider result. SysTwo does not silently fall back to auto for an invalid model policy.

## Minimum Result Evidence

Edit-capable `temp_worktree` tasks must return a diff path. `patch_only` tasks must return a patch proposal; an empty patch-only result is treated as a failed delegation. Test-capable tasks must return test evidence or explain why tests were not run.
