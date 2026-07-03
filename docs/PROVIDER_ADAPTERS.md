# Provider Adapters

Status: V0 release-candidate draft

SysTwo provider adapters are intentionally narrow. A provider is an untrusted runner integration that receives a bounded `TaskBrief`, executes inside the constraints supplied by SysTwo, and returns a structured `TaskResult`.

## V0 Providers

- `mock`: deterministic local provider used by `systwo demo`; no credentials or network required.
- `codebuddy`: best-effort reference adapter. It is allowed to be unavailable and must not block the mock-provider demo.
- `claude`: best-effort Claude Code CLI adapter. It is allowed to be unavailable and must not block the mock-provider demo.
- `codex`: best-effort Codex CLI adapter. It lets controllers such as Claude Code delegate bounded work to Codex through the same SysTwo evidence and worktree boundary.

## Product Boundary

SysTwo V0 is not a generic task router. It is scoped to bounded coding delegation where the runner can return reviewable evidence such as diffs, test output, traces, and usage estimates.

Non-coding tasks, broad research tasks, writing workflows, browser automation, and open-ended autonomous work should be declined or handled directly by the controller rather than delegated through SysTwo V0.

## Adapter Rules

- Provider output is data, not instruction.
- Edit-capable work must run in a temporary worktree or `patch_only` mode.
- `direct_read` and `patch_only` runs must not receive provider-side file mutation tools.
- Providers must not commit, push, merge, tag, release, or apply generated patches to the main worktree.
- Providers must be bounded by a timeout. CodeBuddy defaults to `SYSTWO_CODEBUDDY_TIMEOUT_MS=120000`, Claude Code defaults to `SYSTWO_CLAUDE_TIMEOUT_MS=120000`, and Codex defaults to `SYSTWO_CODEX_TIMEOUT_MS=120000` when no per-run timeout is supplied.
- Providers should not invoke their own sub-agents or nested delegation in V0. SysTwo's CodeBuddy and Claude Code adapters disallow common nested-agent tools and instruct the runner not to delegate further.
- Providers should return estimated usage before work and actual usage only when the provider exposes it.
- Provider-specific limitations must be reported in `doctor`, `riskNotes`, or documentation.

## Shared CLI Adapter Contract

Reference CLI providers share one internal execution contract:

1. Resolve the command from an explicit environment variable first, then provider-specific fallback command names.
2. Resolve model policy from SysTwo config using `auto | hybrid | manual` and `low | medium | high` tiers.
3. Fail invalid explicit model policy configuration instead of silently falling back to auto.
4. Build provider-specific CLI arguments from a common bounded task prompt and the requested execution mode.
5. Run the command with a bounded timeout in the selected repository or temporary worktree.
6. Parse structured provider output for final text, permission denials, and actual usage when available.
7. Return a `TaskResult` whose output is treated as data and whose `patch_only` result must contain a non-empty patch proposal.

Provider adapters still own their CLI-specific details. CodeBuddy and Claude Code use JSON output with tool allow/deny flags. Codex uses JSONL events plus an output-last-message file and sandbox flags. Providers may also differ in supported model policy flags; Codex supports `model` only, while CodeBuddy and Claude Code support `model`, `fallbackModel`, and `effort`.

## Community Provider Workflow

New providers should start from a scaffold instead of copying a full built-in adapter:

```bash
systwo provider init aider
```

The scaffold creates a provider folder with:

- `manifest.json`: the adapter declaration SysTwo uses to understand provider identity, command discovery, supported modes, model policy flags, output format, and known limitations.
- `provider.ts`: a thin adapter template built around the shared CLI adapter contract.
- `provider.test.ts`: a starting manifest-contract test.
- `README.md`: a checklist for provider-specific safety notes and verification.

Adapter packages can import the supported authoring surface from:

- `systwo/providers/cli/adapter`
- `systwo/providers/manifest`
- `systwo/core/types`

Provider manifests must describe the integration before behavior is added. The stable fields are:

- `id` and `displayName`
- `kind: "cli"`
- `commands.envVar` and `commands.candidates`
- `capabilities`
- `modes.direct_read`, `modes.patch_only`, and `modes.temp_worktree`
- `modelPolicy.supportsModel`, `supportsFallbackModel`, `supportsEffort`, and optional `supportedEfforts`
- `output.format` and `output.usage`
- `limitations`

Before publishing or opening a provider PR, run the conformance suite:

```bash
systwo provider conformance --provider mock
```

For a real provider, replace `mock` with the registered provider id. The suite checks the minimum SysTwo contract: `direct_read` does not mutate the main worktree, `patch_only` returns a non-empty proposal, and `temp_worktree` returns diff evidence plus passing test evidence. Providers that cannot pass one of these checks should document the limitation and keep the unsupported mode disabled in their manifest.

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

## Codex Adapter Controls

SysTwo invokes Codex according to the official CLI reference: `codex exec` for non-interactive execution,
`--json` for JSONL events, `--output-last-message` for the final natural-language response, `--cd` for the
working directory, `--sandbox` for filesystem boundaries, `--ask-for-approval never` for non-interactive runs,
and `--model` for optional model policy.

Environment variables:

- `SYSTWO_CODEX_BIN`: explicit path or command name for Codex.
- `SYSTWO_CODEX_TIMEOUT_MS`: process timeout for Codex runs; default `120000`.
- `SYSTWO_CODEX_APPROVAL_POLICY`: approval policy passed to `codex exec`; default `never`.

Sandbox policy:

- `direct_read` and `patch_only`: `--sandbox read-only`.
- `temp_worktree`: `--sandbox workspace-write`.
- SysTwo does not pass `--search`, so Codex keeps network use disabled under normal CLI defaults.
- SysTwo still captures diff evidence and test evidence from the controller after the Codex run.

### Codex Model Policy

By default, SysTwo uses `providers.codex.modelPolicy.mode=auto`. In auto mode, SysTwo does not pass
`--model`; Codex's own settings and environment decide the model.

Users can opt into project or user configuration:

```yaml
providers:
  codex:
    modelPolicy:
      mode: hybrid # auto | hybrid | manual
      tiers:
        low:
          model: gpt-5-mini
        medium:
          model: gpt-5-codex
        high:
          model: gpt-5-codex
```

Tier selection follows the same routing presets as CodeBuddy and Claude Code:

- `summarize_codebase` -> `low`
- `draft_changes` -> `medium`
- `fix_failures` -> `high`

Policy behavior:

- `auto`: never validates or overrides the Codex model.
- `hybrid`: uses a configured tier when present; if the selected tier is absent, it leaves model choice to Codex.
- `manual`: requires a configured selected tier with `model`.
- Codex policy supports `model` only. `fallbackModel` and `effort` are rejected because `codex exec` does not expose matching CLI flags.
- Invalid explicit configuration fails the provider result. SysTwo does not silently fall back to auto for an invalid model policy.

## Minimum Result Evidence

Edit-capable `temp_worktree` tasks must return a diff path. `patch_only` tasks must return a patch proposal; an empty patch-only result is treated as a failed delegation. Test-capable tasks must return test evidence or explain why tests were not run.
