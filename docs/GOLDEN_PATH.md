# Golden Path: Claude Code Controller → Cross-Vendor Runner

Status: V0 release-candidate draft

This is the reference end-to-end workflow SysTwo optimizes for: a high-value controller (Claude Code) delegates a bounded failing-test fix to a lower-cost runner from a different vendor, gets diff and test evidence back, and the usage ledger shows the net token offload.

The mock provider works with zero configuration and is the right first run. The cross-vendor path below is best-effort in V0 (see `docs/ENFORCEMENT_MATRIX.md`).

## 1. Install and verify

```bash
npm install -g systwo
systwo doctor
```

`doctor` reports which runner CLIs (codebuddy, claude, codex) were found. Any missing provider degrades gracefully to a failed delegation with a clear message; the mock provider is always available.

## 2. Register SysTwo as an MCP server in Claude Code

```bash
claude mcp add systwo -- systwo mcp
```

Claude Code now sees four tools: `route_task`, `delegate_task`, `route_then_delegate`, `usage_report`.

## 3. Configure the runner and pricing

`./systwo.yaml` in the repo you work on:

```yaml
version: 1

routing:
  defaultProvider: codex   # cross-vendor runner; use "mock" for a dry run

providers:
  codex:
    modelPolicy:
      mode: manual
      tiers:
        low:
          model: <cheap model id supported by your Codex CLI>

usage:
  pricing:
    controllerUsdPerMTok: 15   # what your controller tokens roughly cost per million
    runnerUsdPerMTok: 0.5      # what your runner tokens roughly cost per million
```

Pricing is optional. Without it the ledger reports token counts only; with it, `usage_report` adds `estimatedSavingsUsd` (a documented heuristic, not billing data).

## 4. Delegate a failing-test fix

Ask the controller to route first, then delegate explicitly. A typical `delegate_task` call the controller should make:

```json
{
  "provider": "codex",
  "preset": "fix_failures",
  "mode": "temp_worktree",
  "brief": {
    "goal": "Fix the failing test in tests/math.test.js without changing public APIs.",
    "contextSummary": "npm test fails: add() subtracts instead of adding.",
    "preset": "fix_failures",
    "allowedFiles": ["src/math.js"],
    "permissions": ["read", "temp_edit", "command"],
    "acceptanceCriteria": ["npm test passes", "Diff limited to src/math.js"],
    "testCommand": "npm test"
  }
}
```

Keep the brief thin. The runner reads code inside the temp worktree itself — do not paste file contents into `contextSummary`; round-tripping context through the controller is exactly the token overhead SysTwo exists to avoid.

## 5. Review evidence, then decide

The result contains `diffPath`, `testEvidence`, `usage`, and `delegatedUsageSummary`. The controller (or you) reviews the diff and applies it manually — SysTwo never applies patches to the main worktree in V0.

## 6. Read the ledger

```bash
systwo usage
```

Example output shape:

```json
{
  "delegations": 3,
  "succeeded": 3,
  "runnerTokens": { "fromActual": 41200, "fromEstimateFallback": 900, "total": 42100 },
  "controllerOverheadTokens": 610,
  "netOffloadedTokens": 41490,
  "estimatedSavingsUsd": 0.6,
  "byProvider": { "codex": { "delegations": 3, "runnerTokens": 42100 } }
}
```

`netOffloadedTokens` is the headline number: high-value controller tokens that were replaced by cheap runner tokens, minus the overhead of writing the briefs. If this number is not clearly positive for your workflow, delegation is not paying for itself — that feedback is the point of the ledger.
