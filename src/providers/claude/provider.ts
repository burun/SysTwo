import type { RunOptions, TaskBrief } from "../../core/types.js";
import type { ClaudeModelPolicy } from "../../config/config.js";
import {
  assistantTextFromContent,
  buildBoundedPrompt,
  createCliProvider,
  isRecord,
  resolveCliModelArgs,
  summarizeProviderFailure,
  usageFromTokenObject,
  type CliModelArgsResolution,
  type ParsedCliOutput
} from "../cli/adapter.js";

export const claudeProvider = createCliProvider<ClaudeModelPolicy>({
  id: "claude",
  displayName: "Claude Code",
  capabilities: ["code_search", "draft_patch", "test_retry", "mechanical_fix"],
  command: {
    envVar: "SYSTWO_CLAUDE_BIN",
    candidates: ["claude"]
  },
  estimateBasis: "Heuristic estimate; Claude Code actual usage is collected only when exposed by its CLI JSON output.",
  doctorMessage(command) {
    return `Claude Code CLI was found as "${command}". SysTwo will invoke it with claude -p, JSON output, bounded tools, and temporary-worktree isolation. Model policy is resolved from SysTwo config at run time; doctor does not make model calls.`;
  },
  doctorMissingMessage: "Claude Code CLI was not found as claude; mock provider remains available.",
  missingSummary: "Claude Code CLI was not found on PATH.",
  missingRiskNotes: ["Install Claude Code or use provider=mock for the zero-config demo."],
  timeoutEnv: "SYSTWO_CLAUDE_TIMEOUT_MS",
  defaultTimeoutMs: 120000,
  getModelPolicy(config) {
    return config?.providers.claude.modelPolicy;
  },
  resolveModelArgs: resolveClaudeModelArgs,
  buildArgs(input, mode, _context, modelArgs) {
    return buildClaudeArgs(input, mode, modelArgs);
  },
  parseOutput: parseClaudeJsonOutput,
  riskNotes(modelResolution, parsedOutput) {
    const permissionDenials = parsedOutput?.permissionDenials ?? [];
    return [
      modelResolution.riskNote,
      "Claude Code provider is best-effort in V0 because provider-side CLI permissions are an external enforcement layer.",
      "Provider output is treated as data and does not trigger follow-up SysTwo actions.",
      ...(permissionDenials.length > 0
        ? [`Claude Code reported permission denials: ${permissionDenials.slice(0, 3).join("; ")}`]
        : [])
    ];
  },
  summarizeFailure(stdoutOrStderr, modelResolution) {
    return summarizeProviderFailure(
      "Claude Code",
      stdoutOrStderr,
      modelResolution,
      "Check the Claude Code supported model list; SysTwo did not fall back to auto for this explicit model configuration."
    );
  }
});

export type ClaudeModelArgsResolution = CliModelArgsResolution;

export function resolveClaudeModelArgs(
  input: TaskBrief,
  modelPolicy: ClaudeModelPolicy | undefined
): ClaudeModelArgsResolution {
  return resolveCliModelArgs(input, modelPolicy, {
    providerName: "Claude Code",
    configGuidance: "Check systwo.yaml, ~/.config/systwo/config.yaml, or the Claude Code supported model list.",
    supportsFallbackModel: true,
    supportsEffort: true,
    supportedEfforts: ["low", "medium", "high", "xhigh", "max"],
    unsupportedFlagTarget: "Claude Code"
  });
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

function buildPrompt(input: TaskBrief, mode: RunOptions["mode"]): string {
  return buildBoundedPrompt(
    input,
    mode,
    "Claude Code",
    "- Do not create, invoke, or delegate to nested agents, subagents, background agents, or web sessions."
  );
}

export function parseClaudeJsonOutput(stdout: string): ParsedCliOutput | undefined {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    const events = Array.isArray(parsed) ? parsed : [parsed];
    let resultText: string | undefined;
    let actualUsage: ParsedCliOutput["actualUsage"];
    const permissionDenials: string[] = [];

    for (const event of events) {
      if (!isRecord(event)) {
        continue;
      }

      if (event.type === "result") {
        if (typeof event.result === "string") {
          resultText = event.result;
        }
        const usageSource = isRecord(event.usage)
          ? { ...event.usage, ...(typeof event.total_cost_usd === "number" ? { total_cost_usd: event.total_cost_usd } : {}) }
          : event;
        actualUsage = actualUsage ?? usageFromTokenObject(usageSource);
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
