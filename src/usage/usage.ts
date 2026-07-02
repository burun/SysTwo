import type { TaskBrief, UsageActual, UsageEstimate } from "../core/types.js";

export function estimateUsageForBrief(brief: Pick<TaskBrief, "goal" | "contextSummary" | "acceptanceCriteria">): UsageEstimate {
  const words = [brief.goal, brief.contextSummary, ...(brief.acceptanceCriteria ?? [])]
    .join(" ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  const inputTokens = Math.max(64, Math.ceil(words * 1.4));
  const outputTokens = 512;
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimatedCostUsd: 0,
    confidence: "low",
    basis: "Heuristic local estimate; no provider credentials or pricing data were used."
  };
}

export function unavailableActualUsage(): UsageActual {
  return {
    source: "unavailable"
  };
}
