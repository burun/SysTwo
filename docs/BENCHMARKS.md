# SysTwo Delegation Benchmarks

Status: V0 methodology draft

`systwo bench` measures one question empirically: **which runner (provider × model) is good enough, and at what cost, for which kind of bounded delegated task?** It is the data source for scenario-level runner recommendations and, eventually, for routing decisions.

## What it measures — and what it does not

- It measures **bounded delegation tasks** executed through `delegate_task` with the same safety constraints as production use (temp worktrees, tool limits, diff/test evidence).
- Quality is scored **only from objective delegation evidence**: test results, diff boundedness, patch presence. There is no LLM judge and no subjective rubric.
- It is **not** a general model capability ranking. Do not compare these numbers with SWE-bench or model leaderboards.
- Results drift as provider CLIs and models change. Every matrix is date-stamped; re-run rather than trust old numbers.

## Running

```bash
# Zero-config smoke run with the mock provider
systwo bench

# Real matrix: 2 providers, one pinned model, 3 runs per cell
systwo bench --cells claude,codebuddy:some-model,codex --runs 3

# Subset of scenarios
systwo bench --cells claude --scenarios single-file-mechanical-fix --runs 5
```

Cells use `provider[:model]` syntax. When a model is given, SysTwo pins it via a manual model policy for all tiers of that provider; without a model, the provider CLI's default is used and the matrix column reflects that honestly.

Output: a markdown matrix on stdout plus date-stamped `bench-*.jsonl` (per-run records) and `bench-*.md` (matrix) under `--out` (default `.systwo/bench`).

## Scenarios

| id | shape | pass criteria |
| --- | --- | --- |
| `single-file-mechanical-fix` | one-line logic bug, failing test | tests pass, non-empty diff, edits within `allowedFiles` |
| `cross-file-logic-fix` | three semantically distinct bugs across two files | same as above |
| `patch-draft-receipt` | `patch_only` feature draft | patch proposal defines the function (not a goal echo), no files mutated |

The `patch-draft-receipt` quality signal is presence-based and weaker than test-based scoring; the planned upgrade is applying the proposed patch in a sandbox worktree and running tests against it.

## Honesty rules

1. Failed and unavailable cells are data points, not errors. A provider whose CLI is missing shows up as `0/N` with the reason recorded — never silently dropped.
2. Cost cells show `cost n/a` when a provider does not report actual cost. No interpolation.
3. Each matrix reports its own total measured spend.
4. Pass rates come from N repetitions (default 3); single runs are not statistically meaningful, so treat `--runs 1` output as a smoke test.
5. The matrix measures the full delegation pipeline (CLI startup, prompts, tool round-trips), which is exactly what a SysTwo user pays — not raw model inference.

## Interpreting a matrix

```text
| Scenario                  | claude:cheap | claude:default | codex |
| single-file-mechanical-fix| 5/5 · $0.04  | 5/5 · $0.15    | 0/5 · cost n/a |
| cross-file-logic-fix      | 3/5 · $0.06  | 5/5 · $0.17    | 0/5 · cost n/a |
```

Read recommendations row by row: mechanical fixes tolerate the cheapest tier; cross-file logic needs a stronger model; a `0/N` column with "CLI was not found" reasons means the cell is untested, not bad. Combine with `systwo usage` pricing to decide whether delegation pays at all for your task size (see the break-even discussion in docs/GOLDEN_PATH.md).
