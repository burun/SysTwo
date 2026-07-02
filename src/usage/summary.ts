import type { TaskResult } from "../core/types.js";

export function formatDelegatedUsageSummary(result: Pick<TaskResult, "provider" | "usage">): string {
  const actual = result.usage.actual;
  if (actual?.source && actual.source !== "unavailable") {
    const tokens = actual.totalTokens ?? sumTokens(actual.inputTokens, actual.outputTokens);
    const cost = actual.costUsd === undefined ? "" : `, cost=$${actual.costUsd.toFixed(4)}`;
    return `Delegated to ${result.provider}: actual usage ${tokens ?? "unknown"} tokens via ${actual.source}${cost}.`;
  }

  const estimated = result.usage.estimated;
  if (estimated) {
    const tokens = estimated.totalTokens ?? sumTokens(estimated.inputTokens, estimated.outputTokens);
    const cost = estimated.estimatedCostUsd === undefined ? "" : `, estimatedCost=$${estimated.estimatedCostUsd.toFixed(4)}`;
    return `Delegated to ${result.provider}: estimated usage ${tokens ?? "unknown"} tokens, confidence=${estimated.confidence}${cost}. Actual usage unavailable.`;
  }

  return `Delegated to ${result.provider}: usage unavailable.`;
}

function sumTokens(input?: number, output?: number): number | undefined {
  if (input === undefined && output === undefined) {
    return undefined;
  }
  return (input ?? 0) + (output ?? 0);
}
