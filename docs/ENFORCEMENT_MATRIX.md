# Safety Floor Enforcement Matrix

Status: V0 release-candidate draft

SysTwo's credibility depends on saying precisely how each safety-floor rule is enforced. This matrix classifies every rule into one of three honesty levels:

- **enforced**: code makes the violation impossible through SysTwo's own surface. A hostile provider CLI cannot cause it through SysTwo.
- **detected**: the violation is possible, but SysTwo detects it after the fact, flags the result as failed, and preserves evidence.
- **advisory**: best-effort filters, prompts, or CLI flags. A hostile or buggy provider CLI can bypass these. Do not rely on them as a security boundary.

SysTwo V0 does not run providers inside an OS-level sandbox. Until it does, any rule that depends on a provider CLI honoring instructions is at most `detected` or `advisory`.

## Matrix

| # | Safety floor rule | Level | How it works today |
| --- | --- | --- | --- |
| 1 | `route_task` never executes runner work | enforced | The router is a pure function; it has no provider or shell access (`src/router/router.ts`). |
| 2 | Delegation requires an explicit controller call | enforced | `delegate_task` is a separate tool; `route_then_delegate` only proceeds on `delegationValue=high` routes (`src/core/route-then-delegate.ts`). |
| 3 | No `apply_result` in V0 | enforced | The tool does not exist in the MCP surface (`src/mcp/server.ts`). |
| 4 | Edit-capable tasks must use `temp_worktree` or `patch_only` | enforced | Policy validation throws before any provider runs (`src/policy/policy.ts`). |
| 5 | Edit-capable tasks return diff evidence | enforced | Missing diff evidence fails the delegation (`src/core/delegate.ts`, `RESULT_DIFF_REQUIRED`); empty `patch_only` results are failed. |
| 6 | Test-capable tasks return test evidence or an explanation | enforced | `not_run` evidence is synthesized when absent (`src/core/delegate.ts`). |
| 7 | Config cannot weaken `read: true` / `network: false` | enforced | Hardcoded during config merge (`src/config/config.ts`). |
| 8 | Worktree concurrency limit | enforced | `createTempWorktree` refuses beyond `worktrees.maxConcurrent` (`src/worktrees/worktrees.ts`, `WORKTREE_LIMIT`). |
| 9 | Runners must not edit the main worktree | detected | Providers run with cwd set to the temp worktree, and `git status` is compared before/after delegation; a change fails the result. A provider CLI that edits and reverts files, touches git hooks/config, or writes outside the repo is not caught. |
| 10 | No commit, push, merge, tag, release | advisory | Forbidden-goal regex on the brief plus provider prompt constraints and tool disallow lists. A provider CLI that ignores flags can still run git. The regex also over-matches (e.g. a goal about "git tag parsing") — treat it as a lint, not a boundary. |
| 11 | Network disabled by default | advisory | SysTwo never passes network permissions to providers and config cannot enable it, but there is no OS-level network isolation. The provider CLI itself talks to its own model API by design. |
| 12 | Secrets are not copied into traces | advisory | `redactSecrets` pattern-scrubs trace and ledger lines (`src/traces/redact.ts`). Pattern-based redaction is best-effort by nature. |
| 13 | Destructive shell commands blocked | advisory | Goal regex (`rm -rf` etc.) plus Bash disallow lists for CLI providers. Enforcement depends on the provider CLI honoring its own flags. |
| 14 | Provider output is untrusted | enforced (by design) | Output is stored as data; SysTwo never executes instructions found in provider output. |

## Per-provider enforcement notes

| Provider | Notes |
| --- | --- |
| mock | Fully controlled by SysTwo; all rows behave as `enforced` in practice. This is why the demo and safety tests use it as the release gate. |
| codebuddy / claude / codex | Rules 10–13 rely on each CLI honoring `--allowedTools` / `--disallowedTools` / permission-mode flags. SysTwo passes conservative flags but cannot verify the CLI obeyed them. Treat these providers as best-effort in V0. |

## Roadmap to stronger enforcement

1. macOS Seatbelt / Linux bubblewrap profiles for provider subprocesses (filesystem scope = temp worktree, no network unless opted in).
2. Container-based runner execution as an opt-in mode.
3. Post-run audit beyond `git status`: hash comparison of the main worktree and repo metadata (`.git/hooks`, `.git/config`).

Rows should only move up this table (advisory → detected → enforced) with code and tests attached; documentation alone never upgrades a row.
