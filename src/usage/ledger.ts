import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { redactSecrets } from "../traces/redact.js";
import type { SysTwoConfig } from "../config/config.js";
import type { TaskResult, UsageActual, UsageEstimate } from "../core/types.js";

export type LedgerEntry = {
  traceId: string;
  timestamp: string;
  provider: string;
  model?: string;
  modelTier?: string;
  preset?: string;
  mode: string;
  status: TaskResult["status"];
  estimated?: UsageEstimate;
  actual?: UsageActual;
  briefOverheadTokens: number;
};

export type ProviderUsageSummary = {
  delegations: number;
  runnerTokens: number;
};

export type UsageReport = {
  delegations: number;
  succeeded: number;
  runnerTokens: {
    fromActual: number;
    fromEstimateFallback: number;
    total: number;
  };
  controllerOverheadTokens: number;
  netOffloadedTokens: number;
  runnerCostUsd?: number;
  estimatedSavingsUsd?: number;
  byProvider: Record<string, ProviderUsageSummary>;
  basis: string;
};

export function ledgerPath(repoPath: string): string {
  return join(repoPath, ".systwo", "ledger.jsonl");
}

export async function appendLedgerEntry(repoPath: string, entry: LedgerEntry): Promise<void> {
  const path = ledgerPath(repoPath);
  await mkdir(dirname(path), { recursive: true });
  const line = redactSecrets(JSON.stringify(entry)) + "\n";
  await writeFile(path, line, { flag: "a" });
}

export async function readLedger(repoPath: string): Promise<LedgerEntry[]> {
  const path = ledgerPath(repoPath);
  if (!existsSync(path)) {
    return [];
  }
  const raw = await readFile(path, "utf8");
  const entries: LedgerEntry[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as LedgerEntry;
      if (parsed.traceId && parsed.provider) {
        entries.push(parsed);
      }
    } catch {
      // Skip corrupted lines instead of failing the whole report.
    }
  }
  return entries;
}

export function summarizeLedger(entries: LedgerEntry[], config?: SysTwoConfig): UsageReport {
  const pricing = config?.usage.pricing;
  let fromActual = 0;
  let fromEstimateFallback = 0;
  let overhead = 0;
  let succeeded = 0;
  let runnerCostUsd = 0;
  let runnerCostKnown = entries.length > 0;
  const byProvider: Record<string, ProviderUsageSummary> = {};

  for (const entry of entries) {
    const actualTokens = totalTokens(entry.actual);
    const runnerTokens = actualTokens ?? totalTokens(entry.estimated) ?? 0;
    if (actualTokens === undefined) {
      fromEstimateFallback += runnerTokens;
    } else {
      fromActual += runnerTokens;
    }
    const actualCostUsd = entry.actual?.costUsd;
    if (actualCostUsd !== undefined) {
      runnerCostUsd += actualCostUsd;
    } else if (pricing?.runnerUsdPerMTok !== undefined) {
      runnerCostUsd += (runnerTokens * pricing.runnerUsdPerMTok) / 1_000_000;
    } else {
      runnerCostKnown = false;
    }
    overhead += entry.briefOverheadTokens ?? 0;
    if (entry.status === "success") {
      succeeded += 1;
    }
    const providerSummary = (byProvider[entry.provider] ??= { delegations: 0, runnerTokens: 0 });
    providerSummary.delegations += 1;
    providerSummary.runnerTokens += runnerTokens;
  }

  const total = fromActual + fromEstimateFallback;
  const report: UsageReport = {
    delegations: entries.length,
    succeeded,
    runnerTokens: { fromActual, fromEstimateFallback, total },
    controllerOverheadTokens: overhead,
    netOffloadedTokens: Math.max(0, total - overhead),
    byProvider,
    basis:
      "Runner tokens use provider-reported actual usage when available, otherwise the pre-run estimate. " +
      "Controller overhead is the heuristic token size of each task brief. " +
      "Net offloaded tokens = runner tokens - controller overhead. " +
      "Runner cost prefers provider-reported actual costUsd and falls back to usage.pricing.runnerUsdPerMTok."
  };

  if (runnerCostKnown) {
    report.runnerCostUsd = round4(runnerCostUsd);
  }

  if (pricing?.controllerUsdPerMTok !== undefined && runnerCostKnown) {
    const controllerCostAvoided = (total * pricing.controllerUsdPerMTok) / 1_000_000;
    const overheadCost = (overhead * pricing.controllerUsdPerMTok) / 1_000_000;
    report.estimatedSavingsUsd = round4(controllerCostAvoided - runnerCostUsd - overheadCost);
    report.basis +=
      " Estimated savings assume the controller would have spent the same tokens the runner spent, priced with usage.pricing.controllerUsdPerMTok.";
  }

  return report;
}

function totalTokens(usage?: { totalTokens?: number; inputTokens?: number; outputTokens?: number; source?: string }): number | undefined {
  if (!usage || usage.source === "unavailable") {
    return undefined;
  }
  if (usage.totalTokens !== undefined) {
    return usage.totalTokens;
  }
  if (usage.inputTokens === undefined && usage.outputTokens === undefined) {
    return undefined;
  }
  return (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
