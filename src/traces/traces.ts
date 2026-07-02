import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { redactSecrets } from "./redact.js";

export type TraceEvent = {
  traceId: string;
  type: string;
  timestamp?: string;
  payload: unknown;
};

export function traceDirectory(repoPath: string): string {
  return join(repoPath, ".systwo", "traces");
}

export function traceEventPath(repoPath: string, traceId: string): string {
  return join(traceDirectory(repoPath), `${traceId}.jsonl`);
}

export async function appendTraceEvent(repoPath: string, event: TraceEvent): Promise<void> {
  await mkdir(traceDirectory(repoPath), { recursive: true });
  const safeEvent = {
    ...event,
    timestamp: event.timestamp ?? new Date().toISOString()
  };
  const line = redactSecrets(JSON.stringify(safeEvent)) + "\n";
  await writeFile(traceEventPath(repoPath, event.traceId), line, { flag: "a" });
}

export function diffPathForTrace(repoPath: string, traceId: string): string {
  return join(traceDirectory(repoPath), `${traceId}.diff`);
}
