import type {
  Provider,
  ProviderCapability,
  RunOptions,
  TaskBrief,
  TaskResult,
  UsageActual
} from "../../core/types.js";
import type { ModelPolicyMode, ModelTierName, SysTwoConfig } from "../../config/config.js";
import { commandExists, runCommand } from "../../core/shell.js";
import { estimateUsageForBrief, unavailableActualUsage } from "../../usage/usage.js";

export type ParsedCliOutput = {
  resultText?: string;
  actualUsage?: UsageActual;
  permissionDenials?: string[];
};

export type CliModelArgsResolution =
  | {
      ok: true;
      args: string[];
      mode: ModelPolicyMode;
      tierName?: ModelTierName;
      model?: string;
      fallbackModel?: string;
      effort?: string;
      riskNote: string;
    }
  | {
      ok: false;
      summary: string;
      riskNotes: string[];
    };

export type CliRunContext = {
  cwd: string;
  outputPath?: string;
  cleanup?: () => Promise<void>;
};

export type CliProviderSpec<ModelPolicy> = {
  id: string;
  displayName: string;
  capabilities: ProviderCapability[];
  command: {
    envVar: string;
    candidates: string[];
  };
  estimateBasis: string;
  doctorMessage(command: string): string;
  doctorMissingMessage: string;
  missingSummary: string;
  missingRiskNotes: string[];
  timeoutEnv: string;
  defaultTimeoutMs: number;
  getModelPolicy(config: SysTwoConfig | undefined): ModelPolicy | undefined;
  resolveModelArgs(input: TaskBrief, modelPolicy: ModelPolicy | undefined): CliModelArgsResolution;
  prepareRun?(input: TaskBrief, options: RunOptions, cwd: string): Promise<CliRunContext>;
  buildArgs(input: TaskBrief, mode: RunOptions["mode"], context: CliRunContext, modelArgs: string[]): string[];
  parseOutput(stdout: string): ParsedCliOutput | undefined;
  readResultText?(context: CliRunContext): Promise<string>;
  riskNotes(modelResolution: Extract<CliModelArgsResolution, { ok: true }>, parsedOutput: ParsedCliOutput | undefined): string[];
  summarizeOutput?(resultText: string, mode: RunOptions["mode"]): string;
  summarizeFailure?(
    stdoutOrStderr: string,
    modelResolution: Extract<CliModelArgsResolution, { ok: true }>
  ): string;
};

export function createCliProvider<ModelPolicy>(spec: CliProviderSpec<ModelPolicy>): Provider {
  return {
    id: spec.id,
    displayName: spec.displayName,
    capabilities: spec.capabilities,
    async estimateUsage(input: TaskBrief) {
      return {
        ...estimateUsageForBrief(input),
        basis: spec.estimateBasis
      };
    },
    async doctor() {
      const command = await resolveCliCommand(spec.command.envVar, spec.command.candidates);
      return {
        ok: Boolean(command),
        message: command ? spec.doctorMessage(command) : spec.doctorMissingMessage
      };
    },
    async runTask(input: TaskBrief, options: RunOptions): Promise<TaskResult> {
      const cwd = options.worktreePath ?? options.repoPath;
      const command = await resolveCliCommand(spec.command.envVar, spec.command.candidates);
      const estimated = await this.estimateUsage(input);
      if (!command) {
        return {
          status: "failed",
          summary: spec.missingSummary,
          provider: spec.id,
          traceId: options.traceId,
          worktreePath: options.worktreePath,
          usage: { estimated, actual: unavailableActualUsage() },
          riskNotes: spec.missingRiskNotes
        };
      }

      const modelResolution = spec.resolveModelArgs(input, spec.getModelPolicy(options.config));
      if (!modelResolution.ok) {
        return {
          status: "failed",
          summary: modelResolution.summary,
          provider: spec.id,
          traceId: options.traceId,
          worktreePath: options.worktreePath,
          usage: { estimated, actual: unavailableActualUsage() },
          riskNotes: modelResolution.riskNotes
        };
      }

      const context = spec.prepareRun ? await spec.prepareRun(input, options, cwd) : { cwd };
      try {
        const args = spec.buildArgs(input, options.mode, context, modelResolution.args);
        const result = await runCommand(command, args, {
          cwd: context.cwd,
          allowFailure: true,
          timeoutMs: options.timeoutMs ?? Number(process.env[spec.timeoutEnv] ?? String(spec.defaultTimeoutMs))
        });

        const parsedOutput = spec.parseOutput(result.stdout);
        const supplementalText = spec.readResultText ? await spec.readResultText(context) : "";
        const resultText = supplementalText.trim()
          ? supplementalText
          : parsedOutput
            ? parsedOutput.resultText ?? ""
            : result.stdout;

        return {
          status: result.exitCode === 0 ? "needs_review" : "failed",
          summary:
            result.exitCode === 0
              ? summarizeCliOutput(spec.displayName, resultText, options.mode, spec.summarizeOutput)
              : summarizeCliFailure(spec.displayName, result.stderr || resultText || result.stdout, modelResolution, spec.summarizeFailure),
          provider: spec.id,
          traceId: options.traceId,
          worktreePath: options.worktreePath,
          inlinePatch: options.mode === "patch_only" && result.exitCode === 0 && resultText.trim() ? resultText : undefined,
          usage: { estimated, actual: parsedOutput?.actualUsage ?? unavailableActualUsage() },
          riskNotes: spec.riskNotes(modelResolution, parsedOutput)
        };
      } finally {
        await context.cleanup?.();
      }
    }
  };
}

export async function resolveCliCommand(envVar: string, candidates: string[]): Promise<string | undefined> {
  const configured = process.env[envVar];
  if (configured && (await commandExists(configured))) {
    return configured;
  }
  for (const candidate of candidates) {
    if (await commandExists(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export function buildBoundedPrompt(input: TaskBrief, mode: RunOptions["mode"], runnerLabel: string, nestedAgentRule: string): string {
  const runnerDescription = runnerLabel ? `${runnerLabel} runner` : "runner";
  return [
    `You are running as a bounded ${runnerDescription} behind SysTwo.`,
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
    nestedAgentRule,
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

export type CliModelPolicyResolutionSpec = {
  providerName: string;
  configGuidance: string;
  supportsFallbackModel: boolean;
  supportsEffort: boolean;
  supportedEfforts?: string[];
  unsupportedFlagTarget?: string;
};

export function resolveCliModelArgs(
  input: TaskBrief,
  modelPolicy: { mode: unknown; tiers?: Partial<Record<ModelTierName, unknown>> } | undefined,
  spec: CliModelPolicyResolutionSpec
): CliModelArgsResolution {
  const policy = modelPolicy ?? { mode: "auto", tiers: {} };
  if (!new Set<string>(["auto", "hybrid", "manual"]).has(String(policy.mode))) {
    return invalidModelPolicy(`Invalid ${spec.providerName} model policy mode: ${String(policy.mode)}.`, spec);
  }

  const mode = policy.mode as ModelPolicyMode;
  if (mode === "auto") {
    return {
      ok: true,
      args: [],
      mode,
      riskNote: `${spec.providerName} model policy mode=auto; SysTwo did not pass --model.`
    };
  }

  if (!isRecord(policy.tiers)) {
    return invalidModelPolicy(`Invalid ${spec.providerName} model policy tiers: expected an object.`, spec);
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
        riskNote: `${spec.providerName} model policy mode=hybrid; no ${tierName} tier is configured, so SysTwo did not pass --model.`
      };
    }
    return invalidModelPolicy(`${spec.providerName} model policy mode=manual requires a configured ${tierName} tier.`, spec);
  }

  if (!isRecord(rawTier)) {
    return invalidModelPolicy(`Invalid ${spec.providerName} model policy tier "${tierName}": expected an object.`, spec);
  }

  const validationError = validateModelTier(tierName, rawTier, mode, spec);
  if (validationError) {
    return invalidModelPolicy(validationError, spec);
  }

  const model = stringField(rawTier, "model");
  const fallbackModel = stringField(rawTier, "fallbackModel");
  const effort = stringField(rawTier, "effort");
  const args: string[] = [];
  if (model) {
    args.push("--model", model);
  }
  if (spec.supportsFallbackModel && fallbackModel) {
    args.push("--fallback-model", fallbackModel);
  }
  if (spec.supportsEffort && effort) {
    args.push("--effort", effort);
  }

  return {
    ok: true,
    args,
    mode,
    tierName,
    model,
    fallbackModel: spec.supportsFallbackModel ? fallbackModel : undefined,
    effort: spec.supportsEffort ? effort : undefined,
    riskNote: `${spec.providerName} model policy mode=${mode}; ${tierName} tier selected${model ? ` model=${model}` : " without --model"}.`
  };
}

export function usageFromTokenObject(
  usage: Record<string, unknown>,
  options: { includeReasoningOutputTokens?: boolean } = {}
): UsageActual | undefined {
  const inputTokens = numberField(usage, "input_tokens") ?? numberField(usage, "inputTokens") ?? numberField(usage, "prompt_tokens");
  const outputTokens =
    numberField(usage, "output_tokens") ?? numberField(usage, "outputTokens") ?? numberField(usage, "completion_tokens");
  const reasoningOutputTokens = options.includeReasoningOutputTokens ? numberField(usage, "reasoning_output_tokens") : undefined;
  const totalTokens =
    numberField(usage, "total_tokens") ??
    numberField(usage, "totalTokens") ??
    (options.includeReasoningOutputTokens ? sumKnownTokens(inputTokens, outputTokens, reasoningOutputTokens) : undefined);
  const costUsd = numberField(usage, "total_cost_usd") ?? numberField(usage, "costUsd") ?? numberField(usage, "cost_usd");

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

export function assistantTextFromContent(source: unknown): string | undefined {
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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function summarizeProviderOutput(providerName: string, stdout: string, mode: RunOptions["mode"]): string {
  const trimmed = stdout.trim();
  if (!trimmed) {
    if (mode === "patch_only") {
      return `${providerName} completed but returned no patch proposal for patch_only mode.`;
    }
    if (mode === "temp_worktree") {
      return `${providerName} completed. SysTwo will convert worktree changes into diff evidence.`;
    }
    return `${providerName} completed without returning result text.`;
  }
  return truncate(trimmed, 1200);
}

export function summarizeProviderFailure(
  providerName: string,
  stdoutOrStderr: string,
  modelResolution: Extract<CliModelArgsResolution, { ok: true }>,
  guidance: string
): string {
  const details = stdoutOrStderr.trim();
  const configuredModel = modelResolution.model ? ` configured model "${modelResolution.model}"` : "";
  const configuredFallback = modelResolution.fallbackModel ? ` fallback "${modelResolution.fallbackModel}"` : "";
  const policyContext =
    modelResolution.mode === "auto"
      ? `${providerName} model policy mode=auto.`
      : `${providerName} model policy mode=${modelResolution.mode}, tier=${modelResolution.tierName}${configuredModel}${configuredFallback}.`;
  const explicitGuidance = modelResolution.mode === "auto" ? "" : ` ${guidance}`;
  const message = `${providerName} failed. ${policyContext}${explicitGuidance}${details ? ` Output: ${details}` : ""}`;
  return truncate(message, 1600);
}

function summarizeCliOutput(
  providerName: string,
  resultText: string,
  mode: RunOptions["mode"],
  customSummarize: CliProviderSpec<unknown>["summarizeOutput"] | undefined
): string {
  return customSummarize ? customSummarize(resultText, mode) : summarizeProviderOutput(providerName, resultText, mode);
}

function summarizeCliFailure(
  providerName: string,
  stdoutOrStderr: string,
  modelResolution: Extract<CliModelArgsResolution, { ok: true }>,
  customSummarize: CliProviderSpec<unknown>["summarizeFailure"] | undefined
): string {
  return customSummarize
    ? customSummarize(stdoutOrStderr, modelResolution)
    : summarizeProviderFailure(providerName, stdoutOrStderr, modelResolution, "SysTwo did not fall back to auto for this explicit model configuration.");
}

function modelTierForTask(input: TaskBrief): ModelTierName {
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

function validateModelTier(
  tierName: ModelTierName,
  tier: Record<string, unknown>,
  mode: ModelPolicyMode,
  spec: CliModelPolicyResolutionSpec
): string | undefined {
  if (mode === "manual" && !isNonEmptyString(tier.model)) {
    return `${spec.providerName} model policy mode=manual requires ${tierName}.model.`;
  }
  if (tier.model !== undefined && !isNonEmptyString(tier.model)) {
    return `Invalid ${spec.providerName} model policy tier "${tierName}": model must be a non-empty string.`;
  }
  if (tier.fallbackModel !== undefined) {
    if (!spec.supportsFallbackModel) {
      return `Invalid ${spec.providerName} model policy tier "${tierName}": fallbackModel is not supported by ${spec.unsupportedFlagTarget}.`;
    }
    if (!isNonEmptyString(tier.fallbackModel)) {
      return `Invalid ${spec.providerName} model policy tier "${tierName}": fallbackModel must be a non-empty string.`;
    }
  }
  if (tier.effort !== undefined) {
    if (!spec.supportsEffort) {
      return `Invalid ${spec.providerName} model policy tier "${tierName}": effort is not supported by ${spec.unsupportedFlagTarget}.`;
    }
    if (!spec.supportedEfforts?.includes(String(tier.effort))) {
      return `Invalid ${spec.providerName} model policy tier "${tierName}": effort must be one of ${spec.supportedEfforts?.join(", ")}.`;
    }
  }
  return undefined;
}

function invalidModelPolicy(message: string, spec: CliModelPolicyResolutionSpec): CliModelArgsResolution {
  return {
    ok: false,
    summary: `${message} SysTwo did not fall back to auto because an explicit ${spec.providerName} model policy was configured. ${spec.configGuidance}`,
    riskNotes: [
      `${spec.providerName} model policy configuration is invalid.`,
      "SysTwo does not silently fall back to auto for invalid explicit model configuration."
    ]
  };
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function sumKnownTokens(...values: Array<number | undefined>): number | undefined {
  const present = values.filter((value): value is number => value !== undefined);
  return present.length > 0 ? present.reduce((sum, value) => sum + value, 0) : undefined;
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}
