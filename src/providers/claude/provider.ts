import type { Provider, RunOptions, TaskBrief, TaskResult, UsageActual } from "../../core/types.js";
import { commandExists, runCommand } from "../../core/shell.js";
import { estimateUsageForBrief, unavailableActualUsage } from "../../usage/usage.js";
import type {
  ClaudeEffort,
  ClaudeModelPolicy,
  ClaudeModelPolicyMode,
  ClaudeModelTier,
  ClaudeModelTierName
} from "../../config/config.js";

async function resolveClaudeCommand(): Promise<string | undefined> {
  const configured = process.env.SYSTWO_CLAUDE_BIN;
  if (configured && (await commandExists(configured))) {
    return configured;
  }
  if (await commandExists("claude")) {
    return "claude";
  }
  return undefined;
}

export const claudeProvider: Provider = {
  id: "claude",
  displayName: "Claude Code",
  capabilities: ["code_search", "draft_patch", "test_retry", "mechanical_fix"],
  async estimateUsage(input: TaskBrief) {
    return {
      ...estimateUsageForBrief(input),
      basis: "Heuristic estimate; Claude Code actual usage is collected only when exposed by its CLI JSON output."
    };
  },
  async doctor() {
    const command = await resolveClaudeCommand();
    return {
      ok: Boolean(command),
      message: command
        ? `Claude Code CLI was found as "${command}". SysTwo will invoke it with claude -p, JSON output, bounded tools, and temporary-worktree isolation. Model policy is resolved from SysTwo config at run time; doctor does not make model calls.`
        : "Claude Code CLI was not found as claude; mock provider remains available."
    };
  },
  async runTask(input: TaskBrief, options: RunOptions): Promise<TaskResult> {
    const cwd = options.worktreePath ?? options.repoPath;
    const command = await resolveClaudeCommand();
    const estimated = await this.estimateUsage(input);
    if (!command) {
      return {
        status: "failed",
        summary: "Claude Code CLI was not found on PATH.",
        provider: "claude",
        traceId: options.traceId,
        worktreePath: options.worktreePath,
        usage: { estimated, actual: unavailableActualUsage() },
        riskNotes: ["Install Claude Code or use provider=mock for the zero-config demo."]
      };
    }

    const modelResolution = resolveClaudeModelArgs(input, options.config?.providers.claude.modelPolicy);
    if (!modelResolution.ok) {
      return {
        status: "failed",
        summary: modelResolution.summary,
        provider: "claude",
        traceId: options.traceId,
        worktreePath: options.worktreePath,
        usage: { estimated, actual: unavailableActualUsage() },
        riskNotes: modelResolution.riskNotes
      };
    }

    const args = buildClaudeArgs(input, options.mode, modelResolution.args);
    const result = await runCommand(command, args, {
      cwd,
      allowFailure: true,
      timeoutMs: options.timeoutMs ?? Number(process.env.SYSTWO_CLAUDE_TIMEOUT_MS ?? "120000")
    });

    const parsedOutput = parseClaudeJsonOutput(result.stdout);
    const resultText = parsedOutput ? parsedOutput.resultText ?? "" : result.stdout;
    const permissionRiskNotes =
      parsedOutput && parsedOutput.permissionDenials.length > 0
        ? [`Claude Code reported permission denials: ${parsedOutput.permissionDenials.slice(0, 3).join("; ")}`]
        : [];

    return {
      status: result.exitCode === 0 ? "needs_review" : "failed",
      summary:
        result.exitCode === 0
          ? summarizeClaudeOutput(resultText, options.mode)
          : summarizeClaudeFailure(result.stderr || resultText || result.stdout, modelResolution),
      provider: "claude",
      traceId: options.traceId,
      worktreePath: options.worktreePath,
      inlinePatch: options.mode === "patch_only" && result.exitCode === 0 && resultText.trim() ? resultText : undefined,
      usage: { estimated, actual: parsedOutput?.actualUsage ?? unavailableActualUsage() },
      riskNotes: [
        modelResolution.riskNote,
        "Claude Code provider is best-effort in V0 because provider-side CLI permissions are an external enforcement layer.",
        "Provider output is treated as data and does not trigger follow-up SysTwo actions.",
        ...permissionRiskNotes
      ]
    };
  }
};

export type ClaudeModelArgsResolution =
  | {
      ok: true;
      args: string[];
      mode: ClaudeModelPolicyMode;
      tierName?: ClaudeModelTierName;
      model?: string;
      fallbackModel?: string;
      effort?: ClaudeEffort;
      riskNote: string;
    }
  | {
      ok: false;
      summary: string;
      riskNotes: string[];
    };

const MODEL_POLICY_MODES = new Set<string>(["auto", "hybrid", "manual"]);
const CLAUDE_EFFORTS = new Set<string>(["low", "medium", "high", "xhigh", "max"]);
const AUTO_MODEL_POLICY: ClaudeModelPolicy = { mode: "auto", tiers: {} };

export function resolveClaudeModelArgs(
  input: TaskBrief,
  modelPolicy: ClaudeModelPolicy | undefined
): ClaudeModelArgsResolution {
  const policy = modelPolicy ?? AUTO_MODEL_POLICY;
  if (!MODEL_POLICY_MODES.has(String(policy.mode))) {
    return invalidModelPolicy(`Invalid Claude Code model policy mode: ${String(policy.mode)}.`);
  }

  const mode = policy.mode as ClaudeModelPolicyMode;
  if (mode === "auto") {
    return {
      ok: true,
      args: [],
      mode,
      riskNote: "Claude Code model policy mode=auto; SysTwo did not pass --model."
    };
  }

  if (!isRecord(policy.tiers)) {
    return invalidModelPolicy("Invalid Claude Code model policy tiers: expected an object.");
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
        riskNote: `Claude Code model policy mode=hybrid; no ${tierName} tier is configured, so SysTwo did not pass --model.`
      };
    }
    return invalidModelPolicy(`Claude Code model policy mode=manual requires a configured ${tierName} tier.`);
  }

  if (!isRecord(rawTier)) {
    return invalidModelPolicy(`Invalid Claude Code model policy tier "${tierName}": expected an object.`);
  }

  const tier = rawTier as ClaudeModelTier;
  const validationError = validateClaudeModelTier(tierName, tier, mode);
  if (validationError) {
    return invalidModelPolicy(validationError);
  }

  const args: string[] = [];
  if (tier.model) {
    args.push("--model", tier.model);
  }
  if (tier.fallbackModel) {
    args.push("--fallback-model", tier.fallbackModel);
  }
  if (tier.effort) {
    args.push("--effort", tier.effort);
  }

  return {
    ok: true,
    args,
    mode,
    tierName,
    model: tier.model,
    fallbackModel: tier.fallbackModel,
    effort: tier.effort,
    riskNote: `Claude Code model policy mode=${mode}; ${tierName} tier selected${tier.model ? ` model=${tier.model}` : " without --model"}.`
  };
}

export function buildClaudeArgs(
  input: TaskBrief,
  mode: RunOptions["mode"] = "temp_worktree",
  modelArgs: string[] = []
): string[] {
  const availableTools = mode === "temp_worktree" ? ["Read", "Edit", "Write", "Grep", "Glob", "Bash"] : ["Read", "Grep", "Glob"];
  const allowedTools = mode === "temp_worktree" ? ["Read", "Edit", "Write", "Grep", "Glob"] : ["Read", "Grep", "Glob"];
  const args = [
    "-p",
    "--output-format",
    "json",
    "--max-turns",
    process.env.SYSTWO_CLAUDE_MAX_TURNS ?? "6",
    "--permission-mode",
    process.env.SYSTWO_CLAUDE_PERMISSION_MODE ?? "acceptEdits",
    "--tools",
    availableTools.join(","),
    "--allowedTools",
    ...allowedTools
  ];

  if (input.testCommand && mode === "temp_worktree") {
    args.push(`Bash(${input.testCommand})`);
  }

  args.push("--disallowedTools", "Agent", "WebFetch", "WebSearch", "mcp__*");

  if (process.env.SYSTWO_CLAUDE_SKIP_PERMISSIONS === "1") {
    args.push("--dangerously-skip-permissions");
  }

  args.push(...modelArgs);
  args.push("--", buildPrompt(input, mode));
  return args;
}

function modelTierForTask(input: TaskBrief): ClaudeModelTierName {
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

function validateClaudeModelTier(
  tierName: ClaudeModelTierName,
  tier: ClaudeModelTier,
  mode: ClaudeModelPolicyMode
): string | undefined {
  if (mode === "manual" && !isNonEmptyString(tier.model)) {
    return `Claude Code model policy mode=manual requires ${tierName}.model.`;
  }
  if (tier.model !== undefined && !isNonEmptyString(tier.model)) {
    return `Invalid Claude Code model policy tier "${tierName}": model must be a non-empty string.`;
  }
  if (tier.fallbackModel !== undefined && !isNonEmptyString(tier.fallbackModel)) {
    return `Invalid Claude Code model policy tier "${tierName}": fallbackModel must be a non-empty string.`;
  }
  if (tier.effort !== undefined && !CLAUDE_EFFORTS.has(String(tier.effort))) {
    return `Invalid Claude Code model policy tier "${tierName}": effort must be one of low, medium, high, xhigh, max.`;
  }
  return undefined;
}

function invalidModelPolicy(message: string): ClaudeModelArgsResolution {
  return {
    ok: false,
    summary: `${message} SysTwo did not fall back to auto because an explicit Claude Code model policy was configured. Check systwo.yaml, ~/.config/systwo/config.yaml, or the Claude Code supported model list.`,
    riskNotes: [
      "Claude Code model policy configuration is invalid.",
      "SysTwo does not silently fall back to auto for invalid explicit model configuration."
    ]
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function buildPrompt(input: TaskBrief, mode: RunOptions["mode"]): string {
  return [
    "You are running as a bounded Claude Code runner behind SysTwo.",
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
    "- Do not create, invoke, or delegate to nested agents, subagents, background agents, or web sessions.",
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

type ParsedClaudeOutput = {
  resultText?: string;
  actualUsage?: UsageActual;
  permissionDenials: string[];
};

export function parseClaudeJsonOutput(stdout: string): ParsedClaudeOutput | undefined {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    const events = Array.isArray(parsed) ? parsed : [parsed];
    let resultText: string | undefined;
    let actualUsage: UsageActual | undefined;
    const permissionDenials: string[] = [];

    for (const event of events) {
      if (!isRecord(event)) {
        continue;
      }

      if (event.type === "result") {
        if (typeof event.result === "string") {
          resultText = event.result;
        }
        actualUsage = actualUsage ?? usageFromClaudeEvent(event);
        if (Array.isArray(event.permission_denials)) {
          permissionDenials.push(...event.permission_denials.map((item) => String(item)));
        }
      }

      if (event.type === "assistant" && !resultText) {
        resultText = assistantTextFromContent(event.message);
      }

      if (event.type === "message" && event.role === "assistant" && !resultText) {
        resultText = assistantTextFromContent(event);
      }
    }

    return { resultText, actualUsage, permissionDenials };
  } catch {
    return undefined;
  }
}

function assistantTextFromContent(source: unknown): string | undefined {
  if (!isRecord(source) || !Array.isArray(source.content)) {
    return undefined;
  }
  const chunks = source.content
    .filter(isRecord)
    .map((chunk) =>
      (chunk.type === "text" || chunk.type === "output_text") && typeof chunk.text === "string" ? chunk.text : ""
    )
    .filter(Boolean);
  return chunks.length > 0 ? chunks.join("\n") : undefined;
}

function usageFromClaudeEvent(event: Record<string, unknown>): UsageActual | undefined {
  const usage = isRecord(event.usage) ? event.usage : event;
  const inputTokens =
    numberField(usage, "input_tokens") ?? numberField(usage, "inputTokens") ?? numberField(usage, "prompt_tokens");
  const outputTokens =
    numberField(usage, "output_tokens") ?? numberField(usage, "outputTokens") ?? numberField(usage, "completion_tokens");
  const totalTokens = numberField(usage, "total_tokens") ?? numberField(usage, "totalTokens");
  const costUsd = numberField(event, "total_cost_usd") ?? numberField(usage, "costUsd") ?? numberField(usage, "cost_usd");

  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined && costUsd === undefined) {
    return undefined;
  }

  return {
    source: "provider",
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(costUsd !== undefined ? { costUsd } : {})
  };
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function summarizeClaudeOutput(stdout: string, mode: RunOptions["mode"]): string {
  const trimmed = stdout.trim();
  if (!trimmed) {
    if (mode === "patch_only") {
      return "Claude Code completed but returned no patch proposal for patch_only mode.";
    }
    if (mode === "temp_worktree") {
      return "Claude Code completed. SysTwo will convert worktree changes into diff evidence.";
    }
    return "Claude Code completed without returning result text.";
  }
  return trimmed.length > 1200 ? `${trimmed.slice(0, 1200)}...` : trimmed;
}

function summarizeClaudeFailure(stdoutOrStderr: string, modelResolution: Extract<ClaudeModelArgsResolution, { ok: true }>): string {
  const details = stdoutOrStderr.trim();
  const configuredModel = modelResolution.model ? ` configured model "${modelResolution.model}"` : "";
  const configuredFallback = modelResolution.fallbackModel ? ` fallback "${modelResolution.fallbackModel}"` : "";
  const policyContext =
    modelResolution.mode === "auto"
      ? "Claude Code model policy mode=auto."
      : `Claude Code model policy mode=${modelResolution.mode}, tier=${modelResolution.tierName}${configuredModel}${configuredFallback}.`;
  const guidance =
    modelResolution.mode === "auto"
      ? ""
      : " Check the Claude Code supported model list; SysTwo did not fall back to auto for this explicit model configuration.";
  const message = `Claude Code failed. ${policyContext}${guidance}${details ? ` Output: ${details}` : ""}`;
  return message.length > 1600 ? `${message.slice(0, 1600)}...` : message;
}
