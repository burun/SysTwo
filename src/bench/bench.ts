import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import { delegateTask } from "../core/delegate.js";
import type { TaskResult } from "../core/types.js";
import { resolveScenarios, type BenchScenario } from "./scenarios.js";

export type BenchCell = {
  provider: string;
  model?: string;
};

export type BenchRecord = {
  scenario: string;
  provider: string;
  model?: string;
  reportedModel?: string;
  run: number;
  pass: boolean;
  reason: string;
  status: TaskResult["status"] | "error";
  totalTokens?: number;
  costUsd?: number;
  durationMs: number;
  traceId?: string;
};

export type BenchOutcome = {
  records: BenchRecord[];
  matrixMarkdown: string;
  totalCostUsd: number;
};

export function parseCells(spec: string): BenchCell[] {
  const cells = spec
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [provider, ...modelParts] = item.split(":");
      const model = modelParts.join(":").trim();
      return { provider: provider.trim(), ...(model ? { model } : {}) };
    });
  if (cells.length === 0) {
    throw new Error("No bench cells provided. Use --cells like claude,codebuddy:some-model,codex.");
  }
  return cells;
}

export function cellLabel(cell: Pick<BenchCell, "provider" | "model">): string {
  return cell.model ? `${cell.provider}:${cell.model}` : cell.provider;
}

const MODEL_POLICY_PROVIDERS = new Set(["codebuddy", "claude", "codex"]);

function cellConfigYaml(cell: BenchCell): string {
  const config: Record<string, unknown> = {
    version: 1,
    routing: { defaultProvider: cell.provider }
  };
  if (cell.model && MODEL_POLICY_PROVIDERS.has(cell.provider)) {
    const tier = { model: cell.model };
    config.providers = {
      [cell.provider]: {
        modelPolicy: {
          mode: "manual",
          tiers: { low: tier, medium: tier, high: tier }
        }
      }
    };
  }
  return YAML.stringify(config);
}

export type RunBenchOptions = {
  cells: BenchCell[];
  scenarios?: string;
  runs?: number;
  log?: (line: string) => void;
};

export async function runBench(options: RunBenchOptions): Promise<BenchOutcome> {
  const scenarios = resolveScenarios(options.scenarios ?? "all");
  const runs = Math.max(1, Math.floor(options.runs ?? 3));
  const log = options.log ?? (() => {});
  const records: BenchRecord[] = [];

  for (const scenario of scenarios) {
    for (const cell of options.cells) {
      for (let run = 1; run <= runs; run += 1) {
        log(`bench: ${scenario.id} × ${cellLabel(cell)} run ${run}/${runs}`);
        records.push(await runBenchCase(scenario, cell, run));
      }
    }
  }

  return {
    records,
    matrixMarkdown: renderMatrix(records, runs),
    totalCostUsd: round4(records.reduce((sum, record) => sum + (record.costUsd ?? 0), 0))
  };
}

async function runBenchCase(scenario: BenchScenario, cell: BenchCell, run: number): Promise<BenchRecord> {
  const startedAt = Date.now();
  const base: Omit<BenchRecord, "pass" | "reason" | "status" | "durationMs"> = {
    scenario: scenario.id,
    provider: cell.provider,
    model: cell.model,
    run
  };
  try {
    const repoPath = await mkdtemp(join(tmpdir(), `systwo-bench-${scenario.id}-`));
    await scenario.setup(repoPath);
    await writeFile(join(repoPath, "systwo.yaml"), cellConfigYaml(cell));

    const result = await delegateTask(
      {
        provider: cell.provider,
        preset: scenario.brief.preset,
        mode: scenario.mode,
        brief: scenario.brief
      },
      repoPath
    );
    const score = scenario.score(result);
    const actual = result.usage.actual;
    return {
      ...base,
      reportedModel: result.model,
      pass: score.pass,
      reason: score.reason,
      status: result.status,
      totalTokens:
        actual?.source !== "unavailable"
          ? actual?.totalTokens ?? sumTokens(actual?.inputTokens, actual?.outputTokens)
          : undefined,
      costUsd: actual?.source !== "unavailable" ? actual?.costUsd : undefined,
      durationMs: Date.now() - startedAt,
      traceId: result.traceId
    };
  } catch (error) {
    return {
      ...base,
      pass: false,
      reason: `error: ${error instanceof Error ? error.message : String(error)}`,
      status: "error",
      durationMs: Date.now() - startedAt
    };
  }
}

export function renderMatrix(records: BenchRecord[], runs: number): string {
  const scenarioIds = [...new Set(records.map((record) => record.scenario))];
  const cells = [...new Set(records.map((record) => cellLabel(record)))];

  const header = `| Scenario | ${cells.join(" | ")} |`;
  const divider = `| --- | ${cells.map(() => "---").join(" | ")} |`;
  const rows = scenarioIds.map((scenarioId) => {
    const columns = cells.map((cell) => {
      const cellRecords = records.filter(
        (record) => record.scenario === scenarioId && cellLabel(record) === cell
      );
      if (cellRecords.length === 0) {
        return "—";
      }
      const passed = cellRecords.filter((record) => record.pass).length;
      const costs = cellRecords
        .map((record) => record.costUsd)
        .filter((cost): cost is number => cost !== undefined)
        .sort((a, b) => a - b);
      const cost = costs.length > 0 ? `$${median(costs).toFixed(4)}` : "cost n/a";
      return `${passed}/${cellRecords.length} · ${cost}`;
    });
    return `| ${scenarioId} | ${columns.join(" | ")} |`;
  });

  const totalCost = records.reduce((sum, record) => sum + (record.costUsd ?? 0), 0);
  return [
    `# SysTwo Bench Matrix`,
    "",
    `Date: ${new Date().toISOString().slice(0, 10)}  `,
    `Runs per cell: ${runs}  `,
    `Cell format: passed/runs · median actual cost (\"cost n/a\" when the provider does not report cost)`,
    "",
    header,
    divider,
    ...rows,
    "",
    `Total measured spend this run: $${round4(totalCost).toFixed(4)}`,
    "",
    "Results measure bounded delegation tasks only; they are not a general model capability ranking.",
    ""
  ].join("\n");
}

export async function writeBenchOutputs(outDir: string, outcome: BenchOutcome): Promise<{ resultsPath: string; matrixPath: string }> {
  await mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const resultsPath = join(outDir, `bench-${stamp}.jsonl`);
  const matrixPath = join(outDir, `bench-${stamp}.md`);
  await writeFile(resultsPath, outcome.records.map((record) => JSON.stringify(record)).join("\n") + "\n");
  await writeFile(matrixPath, outcome.matrixMarkdown);
  return { resultsPath, matrixPath };
}

function sumTokens(input?: number, output?: number): number | undefined {
  if (input === undefined && output === undefined) {
    return undefined;
  }
  return (input ?? 0) + (output ?? 0);
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
