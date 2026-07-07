import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunOptions, TaskBrief } from "../../core/types.js";
import type { CodexModelPolicy } from "../../config/config.js";
import {
  buildBoundedPrompt,
  createCliProvider,
  isRecord,
  resolveCliModelArgs,
  summarizeProviderFailure,
  usageFromTokenObject,
  type CliModelArgsResolution,
  type ParsedCliOutput
} from "../cli/adapter.js";

export const codexProvider = createCliProvider<CodexModelPolicy>({
  id: "codex",
  displayName: "Codex",
  capabilities: ["code_search", "draft_patch", "test_retry", "mechanical_fix"],
  command: {
    envVar: "SYSTWO_CODEX_BIN",
    // The Codex desktop app bundles the CLI without putting it on PATH.
    candidates: ["codex", "/Applications/Codex.app/Contents/Resources/codex"]
  },
  estimateBasis: "Heuristic estimate; Codex actual usage is collected from codex exec JSONL events when available.",
  doctorMessage(command) {
    return `Codex CLI was found as "${command}". SysTwo will invoke it with codex exec, JSONL output, Codex sandbox controls, and temporary-worktree isolation. Model policy is resolved from SysTwo config at run time; doctor does not make model calls.`;
  },
  doctorMissingMessage: "Codex CLI was not found as codex; mock provider remains available.",
  missingSummary: "Codex CLI was not found on PATH.",
  missingRiskNotes: ["Install Codex or use provider=mock for the zero-config demo."],
  timeoutEnv: "SYSTWO_CODEX_TIMEOUT_MS",
  defaultTimeoutMs: 120000,
  getModelPolicy(config) {
    return config?.providers.codex.modelPolicy;
  },
  resolveModelArgs: resolveCodexModelArgs,
  async prepareRun(_input, _options, cwd) {
    const outputDir = await mkdtemp(join(tmpdir(), "systwo-codex-output-"));
    return {
      cwd,
      outputPath: join(outputDir, "last-message.txt"),
      cleanup: () => rm(outputDir, { recursive: true, force: true })
    };
  },
  buildArgs(input, mode, context, modelArgs) {
    return buildCodexArgs(input, mode, context.cwd, context.outputPath, modelArgs);
  },
  parseOutput: parseCodexJsonOutput,
  readResultText(context) {
    return readTextIfPresent(context.outputPath);
  },
  riskNotes(modelResolution) {
    return [
      modelResolution.riskNote,
      "Codex provider is best-effort in V0 because provider-side command controls are enforced by Codex sandbox and prompt constraints rather than SysTwo-owned per-command allowlists.",
      "Provider output is treated as data and does not trigger follow-up SysTwo actions."
    ];
  },
  summarizeFailure(stdoutOrStderr, modelResolution) {
    return summarizeProviderFailure(
      "Codex",
      stdoutOrStderr,
      modelResolution,
      "Check the Codex CLI supported model list; SysTwo did not fall back to auto for this explicit model configuration."
    );
  }
});

export type CodexModelArgsResolution = CliModelArgsResolution;

export function resolveCodexModelArgs(
  input: TaskBrief,
  modelPolicy: CodexModelPolicy | undefined
): CodexModelArgsResolution {
  return resolveCliModelArgs(input, modelPolicy, {
    providerName: "Codex",
    configGuidance: "Check systwo.yaml, ~/.config/systwo/config.yaml, or the Codex CLI supported model list.",
    supportsFallbackModel: false,
    supportsEffort: false,
    unsupportedFlagTarget: "codex exec"
  });
}

export function buildCodexArgs(
  input: TaskBrief,
  mode: RunOptions["mode"] = "temp_worktree",
  cwd: string = process.cwd(),
  outputPath: string = join(tmpdir(), "systwo-codex-last-message.txt"),
  modelArgs: string[] = []
): string[] {
  const sandbox = mode === "temp_worktree" ? "workspace-write" : "read-only";
  return [
    "--sandbox",
    sandbox,
    "-a",
    process.env.SYSTWO_CODEX_APPROVAL_POLICY ?? "never",
    ...modelArgs,
    "exec",
    "--json",
    "--output-last-message",
    outputPath,
    "--cd",
    cwd,
    "--ephemeral",
    buildPrompt(input, mode)
  ];
}

function buildPrompt(input: TaskBrief, mode: RunOptions["mode"]): string {
  return buildBoundedPrompt(
    input,
    mode,
    "Codex",
    "- Do not create, invoke, or delegate to nested agents, subagents, background agents, web sessions, or remote/cloud tasks."
  );
}

export function parseCodexJsonOutput(stdout: string): ParsedCliOutput | undefined {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return undefined;
  }

  let sawJson = false;
  let resultText: string | undefined;
  let actualUsage: ParsedCliOutput["actualUsage"];

  for (const line of lines) {
    let event: unknown;
    try {
      event = JSON.parse(line) as unknown;
      sawJson = true;
    } catch {
      continue;
    }
    if (!isRecord(event)) {
      continue;
    }

    if (event.type === "item.completed" && isRecord(event.item)) {
      const item = event.item;
      if (item.type === "agent_message" && typeof item.text === "string") {
        resultText = item.text;
      }
    }

    if (event.type === "turn.completed") {
      const usage = isRecord(event.usage) ? event.usage : event;
      actualUsage = actualUsage ?? usageFromTokenObject(usage, { includeReasoningOutputTokens: true });
    }
  }

  return sawJson ? { resultText, actualUsage } : undefined;
}

async function readTextIfPresent(path: string | undefined): Promise<string> {
  if (!path) {
    return "";
  }
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}
