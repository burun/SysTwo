import { appendFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultConfig, loadConfig } from "../src/config/config.js";
import { delegateTask } from "../src/core/delegate.js";
import {
  appendLedgerEntry,
  ledgerPath,
  readLedger,
  summarizeLedger,
  type LedgerEntry
} from "../src/usage/ledger.js";
import { createFixtureRepo } from "./helpers/repo.js";

function entry(overrides: Partial<LedgerEntry>): LedgerEntry {
  return {
    traceId: "trace-test",
    timestamp: new Date().toISOString(),
    provider: "mock",
    mode: "temp_worktree",
    status: "success",
    briefOverheadTokens: 0,
    ...overrides
  };
}

describe("usage ledger", () => {
  it("records a ledger entry for each delegation", async () => {
    const repoPath = await createFixtureRepo();
    await delegateTask(
      {
        provider: "mock",
        preset: "fix_failures",
        mode: "temp_worktree",
        brief: {
          goal: "Fix the failing add function test in this repository.",
          contextSummary: "math.js subtracts instead of adding.",
          preset: "fix_failures",
          allowedFiles: ["math.js"],
          permissions: ["read", "temp_edit", "command"],
          acceptanceCriteria: ["node test.js passes", "Return diff evidence"],
          testCommand: "node test.js"
        }
      },
      repoPath
    );

    const entries = await readLedger(repoPath);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.provider).toBe("mock");
    expect(entries[0]?.status).toBe("success");
    expect(entries[0]?.mode).toBe("temp_worktree");
    expect(entries[0]?.briefOverheadTokens).toBeGreaterThan(0);
    expect(entries[0]?.estimated?.totalTokens).toBeGreaterThan(0);
  });

  it("skips corrupted ledger lines instead of failing the report", async () => {
    const repoPath = await mkdtemp(join(tmpdir(), "systwo-ledger-"));
    await mkdir(join(repoPath, ".systwo"), { recursive: true });
    await appendLedgerEntry(repoPath, entry({ traceId: "trace-good" }));
    await appendFile(ledgerPath(repoPath), "{not valid json}\n");
    await appendLedgerEntry(repoPath, entry({ traceId: "trace-good-2" }));

    const entries = await readLedger(repoPath);
    expect(entries.map((item) => item.traceId)).toEqual(["trace-good", "trace-good-2"]);
  });

  it("summarizes runner tokens, controller overhead, and net offload", () => {
    const report = summarizeLedger([
      entry({
        actual: { totalTokens: 1000, source: "provider" },
        estimated: { totalTokens: 900, confidence: "low", basis: "test" },
        briefOverheadTokens: 100
      }),
      entry({
        status: "needs_review",
        actual: { source: "unavailable" },
        estimated: { totalTokens: 500, confidence: "low", basis: "test" },
        briefOverheadTokens: 50
      })
    ]);

    expect(report.delegations).toBe(2);
    expect(report.succeeded).toBe(1);
    expect(report.runnerTokens.fromActual).toBe(1000);
    expect(report.runnerTokens.fromEstimateFallback).toBe(500);
    expect(report.runnerTokens.total).toBe(1500);
    expect(report.controllerOverheadTokens).toBe(150);
    expect(report.netOffloadedTokens).toBe(1350);
    expect(report.byProvider.mock?.delegations).toBe(2);
    expect(report.byProvider.mock?.runnerTokens).toBe(1500);
    expect(report.estimatedSavingsUsd).toBeUndefined();
  });

  it("computes estimated savings when pricing is configured", () => {
    const config = {
      ...defaultConfig,
      usage: {
        ...defaultConfig.usage,
        pricing: { controllerUsdPerMTok: 10, runnerUsdPerMTok: 1 }
      }
    };
    const report = summarizeLedger(
      [
        entry({
          actual: { totalTokens: 1_000_000, source: "provider" },
          briefOverheadTokens: 100_000
        })
      ],
      config
    );

    // avoided 10 USD at controller price, paid 1 USD runner + 1 USD overhead at controller price
    expect(report.estimatedSavingsUsd).toBe(8);
  });

  it("loads usage pricing from systwo.yaml without weakening the safety floor", async () => {
    const repoPath = await mkdtemp(join(tmpdir(), "systwo-pricing-"));
    await writeFile(
      join(repoPath, "systwo.yaml"),
      [
        "usage:",
        "  pricing:",
        "    controllerUsdPerMTok: 15",
        "    runnerUsdPerMTok: 0.5",
        "permissions:",
        "  network: true",
        ""
      ].join("\n")
    );

    const config = loadConfig(repoPath);
    expect(config.usage.pricing).toEqual({ controllerUsdPerMTok: 15, runnerUsdPerMTok: 0.5 });
    expect(config.usage.estimateBeforeRun).toBe(true);
    expect(config.permissions.network).toBe(false);
  });
});
