# Delegation Matrix — Measured Results

This file archives date-stamped `systwo bench` matrices with the exact setup used. Results drift with CLI and model versions; re-run rather than trust old numbers. Methodology: [BENCHMARKS.md](BENCHMARKS.md).

## 2026-07-07 — first three-cell matrix

Setup: macOS, Claude Code CLI 2.1.198, Codex CLI 0.142.5 (desktop-app bundle), `--runs 2`, `SYSTWO_CLAUDE_MAX_TURNS=12`.

| Scenario | claude (default model) | claude:claude-haiku-4-5-20251001 | codex (default model) |
| --- | --- | --- | --- |
| single-file-mechanical-fix | 2/2 · $0.0695 | 2/2 · $0.0356 | 2/2 · cost n/a |
| cross-file-logic-fix | 2/2 · $0.1352 | 2/2 · $0.0437 | 2/2 · cost n/a |
| patch-draft-receipt | 2/2 · $0.0706 | 2/2 · $0.0318 | 2/2 · cost n/a |

Total measured spend: $0.7729. 18/18 delegations passed.

### Observations

1. **The cheap tier held up.** Haiku passed every scenario, including the cross-file three-bug fix, at roughly 1/2–1/3 of the default-model cost. On these bounded shapes the cheapest configured tier is currently the rational default.
2. **No quality separation yet.** Every cell is 2/2, so this suite measures cost, not capability limits. The suite needs a difficulty ladder (larger repos, ambiguous briefs, dependency-tracing bugs) until strong and cheap cells separate.
3. **Cross-provider token counts are not comparable.** Codex reports ~36k–78k tokens per run (its accounting includes cached/context tokens); Claude reports ~0.5k–3k billed tokens for the same work. Compare cost within a provider, or pass rate across providers — never raw token counts across vendors.
4. **Subscription runners have no USD column by design.** Codex ran on a subscription plan and reports no per-call cost; for subscription runners the relevant budget is quota and wall-clock, not dollars (see the two-ledger discussion in GOLDEN_PATH.md).
5. **Fixed overhead confirmed again.** Claude's cost floor (~$0.07 even for a one-line fix) matches the per-invocation overhead seen in the usage-ledger experiments; scenario size barely moved it.

### Open follow-ups

- Add harder scenarios until pass rates separate across tiers.
- Add a `codebuddy` column (CLI present on this machine but model configuration was not exercised in this run).
- Feed per-scenario winners into `route_task` provider/tier recommendations.
