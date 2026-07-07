import { describe, expect, it } from "vitest";
import { cellLabel, parseCells, renderMatrix, runBench, type BenchRecord } from "../src/bench/bench.js";
import { benchScenarios, resolveScenarios, scoreEditScenario } from "../src/bench/scenarios.js";
import type { TaskResult } from "../src/core/types.js";

function taskResult(overrides: Partial<TaskResult>): TaskResult {
  return {
    status: "success",
    summary: "ok",
    provider: "mock",
    traceId: "trace-bench",
    usage: { estimated: undefined, actual: { source: "unavailable" } },
    riskNotes: [],
    ...overrides
  };
}

describe("bench cells", () => {
  it("parses provider and provider:model cells", () => {
    expect(parseCells("claude,codebuddy:some-model,codex")).toEqual([
      { provider: "claude" },
      { provider: "codebuddy", model: "some-model" },
      { provider: "codex" }
    ]);
  });

  it("keeps colons inside model ids", () => {
    expect(parseCells("codebuddy:vendor:model-v2")).toEqual([{ provider: "codebuddy", model: "vendor:model-v2" }]);
    expect(cellLabel({ provider: "codebuddy", model: "vendor:model-v2" })).toBe("codebuddy:vendor:model-v2");
  });

  it("rejects an empty cell list", () => {
    expect(() => parseCells(" , ")).toThrow(/No bench cells/);
  });
});

describe("bench scoring", () => {
  it("passes a bounded edit with passing tests", () => {
    const score = scoreEditScenario(
      taskResult({
        changedFiles: ["math.js"],
        testEvidence: { command: "node test.js", status: "passed", outputSummary: "ok" }
      }),
      ["math.js"]
    );
    expect(score.pass).toBe(true);
  });

  it("fails edits outside allowedFiles even when tests pass", () => {
    const score = scoreEditScenario(
      taskResult({
        changedFiles: ["math.js", "test.js"],
        testEvidence: { command: "node test.js", status: "passed", outputSummary: "ok" }
      }),
      ["math.js"]
    );
    expect(score.pass).toBe(false);
    expect(score.reason).toContain("test.js");
  });

  it("fails when there is no diff evidence", () => {
    const score = scoreEditScenario(
      taskResult({
        changedFiles: [],
        testEvidence: { command: "node test.js", status: "passed", outputSummary: "ok" }
      }),
      ["math.js"]
    );
    expect(score.pass).toBe(false);
    expect(score.reason).toBe("no diff evidence");
  });

  it("does not let a goal echo pass the patch-draft scenario", () => {
    const patchDraft = benchScenarios.find((scenario) => scenario.id === "patch-draft-receipt");
    const echo = patchDraft?.score(
      taskResult({
        status: "needs_review",
        inlinePatch: "Goal: Draft a formatReceipt(items, opts) function for cart.js."
      })
    );
    expect(echo?.pass).toBe(false);

    const real = patchDraft?.score(
      taskResult({
        status: "needs_review",
        inlinePatch: "```diff\n+export function formatReceipt(items, opts = {}) {\n+  return '';\n+}\n```"
      })
    );
    expect(real?.pass).toBe(true);
  });
});

describe("bench execution", () => {
  it("runs the single-file scenario with the mock provider and records passes", async () => {
    const outcome = await runBench({
      cells: [{ provider: "mock" }],
      scenarios: "single-file-mechanical-fix",
      runs: 2
    });

    expect(outcome.records).toHaveLength(2);
    for (const record of outcome.records) {
      expect(record.pass).toBe(true);
      expect(record.status).toBe("success");
      expect(record.reportedModel).toBe("deterministic");
      expect(record.costUsd).toBeUndefined();
    }
    expect(outcome.matrixMarkdown).toContain("| single-file-mechanical-fix | 2/2 · cost n/a |");
  }, 60000);

  it("records failures as data points instead of throwing", async () => {
    const outcome = await runBench({
      cells: [{ provider: "mock" }],
      scenarios: "cross-file-logic-fix",
      runs: 1
    });

    expect(outcome.records).toHaveLength(1);
    expect(outcome.records[0]?.pass).toBe(false);
    expect(outcome.records[0]?.status).not.toBe("error");
    expect(outcome.matrixMarkdown).toContain("0/1");
  }, 60000);
});

describe("bench matrix rendering", () => {
  it("aggregates pass rate and median cost per cell", () => {
    const records: BenchRecord[] = [
      { scenario: "s1", provider: "claude", run: 1, pass: true, reason: "ok", status: "needs_review", costUsd: 0.1, durationMs: 1 },
      { scenario: "s1", provider: "claude", run: 2, pass: false, reason: "tests failed", status: "failed", costUsd: 0.3, durationMs: 1 },
      { scenario: "s1", provider: "codex", model: "cheap-1", run: 1, pass: true, reason: "ok", status: "needs_review", durationMs: 1 }
    ];
    const markdown = renderMatrix(records, 2);
    expect(markdown).toContain("| Scenario | claude | codex:cheap-1 |");
    expect(markdown).toContain("| s1 | 1/2 · $0.2000 | 1/1 · cost n/a |");
    expect(markdown).toContain("Total measured spend this run: $0.4000");
  });

  it("resolves scenario subsets and rejects unknown ids", () => {
    expect(resolveScenarios("all")).toHaveLength(benchScenarios.length);
    expect(resolveScenarios("single-file-mechanical-fix")[0]?.id).toBe("single-file-mechanical-fix");
    expect(() => resolveScenarios("nope")).toThrow(/Unknown bench scenario/);
  });
});
