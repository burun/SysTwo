import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Provider, RunOptions, TaskBrief, TaskResult, UsageActual } from "../../core/types.js";
import { commandExists, runCommand } from "../../core/shell.js";
import { estimateUsageForBrief, unavailableActualUsage } from "../../usage/usage.js";
import type {
  CodexModelPolicy,
  CodexModelPolicyMode,
  CodexModelTier,
  CodexModelTierName
} from "../../config/config.js";

async function resolveCodexCommand(): Promise<string | undefined> {
  const configured = process.env.SYSTWO_CODEX_BIN;
  if (configured && (await commandExists(configured))) {
    return configured;
  }
  if (await commandExists("codex")) {
    return "codex";
  }
  return undefined;
}

export const codexProvider: Provider = {
  id: "codex",
  displayName: "Codex",
  capabilities: ["code_search", "draft_patch", "test_retry", "mechanical_fix"],
  async estimateUsage(input: TaskBrief) {
    return {
      ...estimateUsageForBrief(input),
      basis: "Heuristic estimate; Codex actual usage is collected from codex exec JSONL events when available."
    };
  },
  async doctor() {
    const command = await resolveCodexCommand();
    return {
      ok: Boolean(command),
      message: command
        ? `Codex CLI was found as "${command}". SysTwo will invoke it with codex exec, JSONL output, Codex sandbox controls, and temporary-worktree isolation. Model policy is resolved from SysTwo config at run time; doctor does not make model calls.`
        : "Codex CLI was not found as codex; mock provider remains available."
    };
  },
  async runTask(input: TaskBrief, options: RunOptions): Promise<TaskResult> {
    const cwd = options.worktreePath ?? options.repoPath;
    const command = await resolveCodexCommand();
    const estimated = await this.estimateUsage(input);
    if (!command) {
      return {
        status: "failed",
        summary: "Codex CLI was not found on PATH.",
        provider: "codex",
        traceId: options.traceId,
        worktreePath: options.worktreePath,
        usage: { estimated, actual: unavailableActualUsage() },
        riskNotes: ["Install Codex or use provider=mock for the zero-config demo."]
      };
    }

    const modelResolution = resolveCodexModelArgs(input, options.config?.providers.codex.modelPolicy);
    if (!modelResolution.ok) {
      return {
        status: "failed",
        summary: modelResolution.summary,
        provider: "codex",
        traceId: options.traceId,
        worktreePath: options.worktreePath,
        usage: { estimated, actual: unavailableActualUsage() },
        riskNotes: modelResolution.riskNotes
      };
    }

    const outputDir = await mkdtemp(join(tmpdir(), "systwo-codex-output-"));
    const outputPath = join(outputDir, "last-message.txt");
    try {
      const args = buildCodexArgs(input, options.mode, cwd, outputPath, modelResolution.args);
      const result = await runCommand(command, args, {
        cwd,
        allowFailure: true,
        timeoutMs: options.timeoutMs ?? Number(process.env.SYSTWO_CODEX_TIMEOUT_MS ?? "120000")
      });

      const lastMessage = await readTextIfPresent(outputPath);
      const parsedOutput = parseCodexJsonOutput(result.stdout);
      const resultText = lastMessage.trim() ? lastMessage : parsedOutput ? parsedOutput.resultText ?? "" : result.stdout;

      return {
        status: result.exitCode === 0 ? "needs_review" : "failed",
        summary:
          result.exitCode === 0
            ? summarizeCodexOutput(resultText, options.mode)
            : summarizeCodexFailure(result.stderr || resultText || result.stdout, modelResolution),
        provider: "codex",
        traceId: options.traceId,
        worktreePath: options.worktreePath,
        inlinePatch: options.mode === "patch_only" && result.exitCode === 0 && resultText.trim() ? resultText : undefined,
        usage: { estimated, actual: parsedOutput?.actualUsage ?? unavailableActualUsage() },
        riskNotes: [
          modelResolution.riskNote,
          "Codex provider is best-effort in V0 because provider-side command controls are enforced by Codex sandbox and prompt constraints rather than SysTwo-owned per-command allowlists.",
          "Provider output is treated as data and does not trigger follow-up SysTwo actions."
        ]
      };
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
};

export type CodexModelArgsResolution =
  | {
      ok: true;
      args: string[];
      mode: CodexModelPolicyMode;
      tierName?: CodexModelTierName;
      model?: string;
      riskNote: string;
    }
  | {
      ok: false;
      summary: string;
      riskNotes: string[];
    };

const MODEL_POLICY_MODES = new Set<string>(["auto", "hybrid", "manual"]);
const AUTO_MODEL_POLICY: CodexModelPolicy = { mode: "auto", tiers: {} };

export function resolveCodexModelArgs(
  input: TaskBrief,
  modelPolicy: CodexModelPolicy | undefined
): CodexModelArgsResolution {
  const policy = modelPolicy ?? AUTO_MODEL_POLICY;
  if (!MODEL_POLICY_MODES.has(String(policy.mode))) {
    return invalidModelPolicy(`Invalid Codex model policy mode: ${String(policy.mode)}.`);
  }

  const mode = policy.mode as CodexModelPolicyMode;
  if (mode === "auto") {
    return {
      ok: true,
      args: [],
      mode,
      riskNote: "Codex model policy mode=auto; SysTwo did not pass --model."
    };
  }

  if (!isRecord(policy.tiers)) {
    return invalidModelPolicy("Invalid Codex model policy tiers: expected an object.");
  }

  const tierName = modelTierForTask(input);
  const rawTier = policy.tiers[tierName];
  if (!isConfiguredTier(rawTier)) {
    if (mode === "hybrid") {
      return {
        ok: true,
        args: [],
        mode,
        tierName,
        riskNote: `Codex model policy mode=hybrid; no ${tierName} tier is configured, so SysTwo did not pass --model.`
      };
    }
    return invalidModelPolicy(`Codex model policy mode=manual requires a configured ${tierName} tier.`);
  }

  if (!isRecord(rawTier)) {
    return invalidModelPolicy(`Invalid Codex model policy tier "${tierName}": expected an object.`);
  }

  const tier = rawTier as CodexModelTier & Record<string, unknown>;
  const validationError = validateCodexModelTier(tierName, tier, mode);
  if (validationError) {
    return invalidModelPolicy(validationError);
  }

  const args: string[] = [];
  if (tier.model) {
    args.push("--model", tier.model);
  }

  return {
    ok: true,
    args,
    mode,
    tierName,
    model: tier.model,
    riskNote: `Codex model policy mode=${mode}; ${tierName} tier selected${tier.model ? ` model=${tier.model}` : " without --model"}.`
  };
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

function modelTierForTask(input: TaskBrief): CodexModelTierName {
  if (input.preset === "fix_failures") {
    return "high";
  }
  if (input.preset === "draft_changes") {
    return "medium";
  }
  if (input.permissions.includes("temp_edit")) {
    return "medium";
  }
  return "low";
}

function isConfiguredTier(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }
  if (!isRecord(value)) {
    return true;
  }
  return Boolean(value.model ?? value.fallbackModel ?? value.effort);
}

function validateCodexModelTier(
  tierName: CodexModelTierName,
  tier: CodexModelTier & Record<string, unknown>,
  mode: CodexModelPolicyMode
): string | undefined {
  if (mode === "manual" && !isNonEmptyString(tier.model)) {
    return `Codex model policy mode=manual requires ${tierName}.model.`;
  }
  if (tier.model !== undefined && !isNonEmptyString(tier.model)) {
    return `Invalid Codex model policy tier "${tierName}": model must be a non-empty string.`;
  }
  if (tier.fallbackModel !== undefined) {
    return `Invalid Codex model policy tier "${tierName}": fallbackModel is not supported by codex exec.`;
  }
  if (tier.effort !== undefined) {
    return `Invalid Codex model policy tier "${tierName}": effort is not supported by codex exec.`;
  }
  return undefined;
}

function invalidModelPolicy(message: string): CodexModelArgsResolution {
  return {
    ok: false,
    summary: `${message} SysTwo did not fall back to auto because an explicit Codex model policy was configured. Check systwo.yaml, ~/.config/systwo/config.yaml, or the Codex CLI supported model list.`,
    riskNotes: [
      "Codex model policy configuration is invalid.",
      "SysTwo does not silently fall back to auto for invalid explicit model configuration."
    ]
  };
}

function buildPrompt(input: TaskBrief, mode: RunOptions["mode"]): string {
  return [
    "You are running as a bounded Codex runner behind SysTwo.",
    "",
    `Goal: ${input.goal}`,
    input.contextSummary ? `Context: ${input.contextSummary}` : "",
    input.allowedFiles?.length ? `Allowed files: ${input.allowedFiles.join(", ")}` : "",
    input.acceptanceCriteria.length
      ? `Acceptance criteria:\n${input.acceptanceCriteria.map((item) => `- ${item}`).join("\n")}`
      : "",
    input.testCommand && mode === "temp_worktree" ? `Test command: ${input.testCommand}` : "",
    "",
    "Rules:",
    "- Work only in the current working directory.",
    mode !== "temp_worktree" ? "- Read-only filesystem mode: do not edit, write, delete, or create files." : "",
    mode === "patch_only" ? "- Return a patch proposal in your final answer instead of mutating files." : "",
    "- Do not create, invoke, or delegate to nested agents, subagents, background agents, web sessions, or remote/cloud tasks.",
    mode === "temp_worktree"
      ? "- Do not commit, push, merge, tag, release, or apply changes outside this worktree."
      : "- Do not commit, push, merge, tag, release, or apply changes.",
    "- Make the smallest bounded change needed.",
    mode === "temp_worktree" ? "- Run the test command when provided." : "",
    "- Leave final review and patch application to the controller."
  ]
    .filter(Boolean)
    .join("\n");
}

type ParsedCodexOutput = {
  resultText?: string;
  actualUsage?: UsageActual;
};

export function parseCodexJsonOutput(stdout: string): ParsedCodexOutput | undefined {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return undefined;
  }

  let sawJson = false;
  let resultText: string | undefined;
  let actualUsage: UsageActual | undefined;

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
      actualUsage = actualUsage ?? usageFromCodexObject(usage);
    }
  }

  return sawJson ? { resultText, actualUsage } : undefined;
}

function usageFromCodexObject(usage: Record<string, unknown>): UsageActual | undefined {
  const inputTokens = numberField(usage, "input_tokens") ?? numberField(usage, "inputTokens");
  const outputTokens = numberField(usage, "output_tokens") ?? numberField(usage, "outputTokens");
  const reasoningOutputTokens = numberField(usage, "reasoning_output_tokens");
  const totalTokens = numberField(usage, "total_tokens") ?? sumKnownTokens(inputTokens, outputTokens, reasoningOutputTokens);

  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) {
    return undefined;
  }

  return {
    source: "provider",
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {})
  };
}

function sumKnownTokens(...values: Array<number | undefined>): number | undefined {
  const present = values.filter((value): value is number => value !== undefined);
  return present.length > 0 ? present.reduce((sum, value) => sum + value, 0) : undefined;
}

function summarizeCodexOutput(stdout: string, mode: RunOptions["mode"]): string {
  const trimmed = stdout.trim();
  if (!trimmed) {
    if (mode === "patch_only") {
      return "Codex completed but returned no patch proposal for patch_only mode.";
    }
    if (mode === "temp_worktree") {
      return "Codex completed. SysTwo will convert worktree changes into diff evidence.";
    }
    return "Codex completed without returning result text.";
  }
  return trimmed.length > 1200 ? `${trimmed.slice(0, 1200)}...` : trimmed;
}

function summarizeCodexFailure(stdoutOrStderr: string, modelResolution: Extract<CodexModelArgsResolution, { ok: true }>): string {
  const details = stdoutOrStderr.trim();
  const configuredModel = modelResolution.model ? ` configured model "${modelResolution.model}"` : "";
  const policyContext =
    modelResolution.mode === "auto"
      ? "Codex model policy mode=auto."
      : `Codex model policy mode=${modelResolution.mode}, tier=${modelResolution.tierName}${configuredModel}.`;
  const guidance =
    modelResolution.mode === "auto"
      ? ""
      : " Check the Codex CLI supported model list; SysTwo did not fall back to auto for this explicit model configuration.";
  const message = `Codex failed. ${policyContext}${guidance}${details ? ` Output: ${details}` : ""}`;
  return message.length > 1600 ? `${message.slice(0, 1600)}...` : message;
}

async function readTextIfPresent(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}
