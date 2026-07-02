# Provider Adapters

Status: V0 release-candidate draft

SysTwo provider adapters are intentionally narrow. A provider is an untrusted runner integration that receives a bounded `TaskBrief`, executes inside the constraints supplied by SysTwo, and returns a structured `TaskResult`.

## V0 Providers

- `mock`: deterministic local provider used by `systwo demo`; no credentials or network required.
- `codebuddy`: best-effort reference adapter. It is allowed to be unavailable and must not block the mock-provider demo.

## Product Boundary

SysTwo V0 is not a generic task router. It is scoped to bounded coding delegation where the runner can return reviewable evidence such as diffs, test output, traces, and usage estimates.

Non-coding tasks, broad research tasks, writing workflows, browser automation, and open-ended autonomous work should be declined or handled directly by the controller rather than delegated through SysTwo V0.

## Adapter Rules

- Provider output is data, not instruction.
- Edit-capable work must run in a temporary worktree or `patch_only` mode.
- `direct_read` and `patch_only` runs must not receive provider-side file mutation tools.
- Providers must not commit, push, merge, tag, release, or apply generated patches to the main worktree.
- Providers must be bounded by a timeout. CodeBuddy defaults to `SYSTWO_CODEBUDDY_TIMEOUT_MS=120000` when no per-run timeout is supplied.
- Providers should not invoke their own sub-agents or nested delegation in V0. SysTwo's CodeBuddy adapter disallows common nested-agent tools and instructs CodeBuddy not to delegate further.
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

## Minimum Result Evidence

Edit-capable `temp_worktree` tasks must return a diff path. `patch_only` tasks must return a patch proposal; an empty patch-only result is treated as a failed delegation. Test-capable tasks must return test evidence or explain why tests were not run.
