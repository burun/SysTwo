import type { RunOptions, TaskBrief } from "../../core/types.js";
import type { CodeBuddyModelPolicy } from "../../config/config.js";
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

export const codeBuddyProvider = createCliProvider<CodeBuddyModelPolicy>({
  id: "codebuddy",
  displayName: "CodeBuddy",
  capabilities: ["code_search", "draft_patch", "test_retry", "mechanical_fix"],
  command: {
    envVar: "SYSTWO_CODEBUDDY_BIN",
    candidates: ["codebuddy", "cbc"]
  },
  estimateBasis: "Heuristic estimate; CodeBuddy actual usage is collected only when exposed by its CLI.",
  doctorMessage(command) {
    return `CodeBuddy CLI was found as "${command}". SysTwo will invoke it with print/headless mode in a temporary worktree. Model policy is resolved from SysTwo config at run time; doctor does not make model calls.`;
  },
  doctorMissingMessage: "CodeBuddy CLI was not found as codebuddy or cbc; mock provider remains available.",
  missingSummary: "CodeBuddy CLI was not found on PATH.",
  missingRiskNotes: ["Install CodeBuddy or use provider=mock for the zero-config demo."],
  timeoutEnv: "SYSTWO_CODEBUDDY_TIMEOUT_MS",
  defaultTimeoutMs: 120000,
  getModelPolicy(config) {
    return config?.providers.codebuddy.modelPolicy;
  },
  resolveModelArgs: resolveCodeBuddyModelArgs,
  buildArgs(input, mode, _context, modelArgs) {
    return buildCodeBuddyArgs(input, mode, modelArgs);
  },
  parseOutput: parseCodeBuddyJsonOutput,
  riskNotes(modelResolution, parsedOutput) {
    const permissionDenials = parsedOutput?.permissionDenials ?? [];
    return [
      modelResolution.riskNote,
      "CodeBuddy provider is best-effort in V0 because its exact non-interactive CLI contract can vary.",
      "Provider output is treated as data and does not trigger follow-up SysTwo actions.",
      ...(permissionDenials.length > 0
        ? [`CodeBuddy reported permission denials: ${permissionDenials.slice(0, 3).join("; ")}`]
        : [])
    ];
  },
  summarizeFailure(stdoutOrStderr, modelResolution) {
    return summarizeProviderFailure(
      "CodeBuddy",
      stdoutOrStderr,
      modelResolution,
      "Check CodeBuddy models.json, availableModels, or the CodeBuddy CLI supported model list; SysTwo did not fall back to auto for this explicit model configuration."
    );
  }
});

export type CodeBuddyModelArgsResolution = CliModelArgsResolution;

export function resolveCodeBuddyModelArgs(
  input: TaskBrief,
  modelPolicy: CodeBuddyModelPolicy | undefined
): CodeBuddyModelArgsResolution {
  return resolveCliModelArgs(input, modelPolicy, {
    providerName: "CodeBuddy",
    configGuidance:
      "Check systwo.yaml, ~/.config/systwo/config.yaml, CodeBuddy models.json, availableModels, or the CodeBuddy CLI supported model list.",
    supportsFallbackModel: true,
    supportsEffort: true,
    supportedEfforts: ["minimal", "low", "medium", "high", "xhigh", "max"],
    unsupportedFlagTarget: "CodeBuddy"
  });
}

export function buildCodeBuddyArgs(
  input: TaskBrief,
  mode: RunOptions["mode"] = "temp_worktree",
  modelArgs: string[] = []
): string[] {
  const allowedTools = mode === "temp_worktree" ? ["Read", "Edit", "Write", "Grep", "Glob"] : ["Read", "Grep", "Glob"];
  const args = [
    "-p",
    "--output-format",
    "json",
    "--max-turns",
    process.env.SYSTWO_CODEBUDDY_MAX_TURNS ?? "6",
    "--permission-mode",
    process.env.SYSTWO_CODEBUDDY_PERMISSION_MODE ?? "acceptEdits",
    "--allowedTools",
    ...allowedTools
  ];

  if (input.testCommand && mode === "temp_worktree") {
    args.push(`Bash(${input.testCommand})`);
  }

  args.push("--disallowedTools", "Agent", "Task", "Subagent", "WebFetch", "WebSearch");

  if (process.env.SYSTWO_CODEBUDDY_SKIP_PERMISSIONS === "1") {
    args.push("-y");
  }

  args.push(...modelArgs);
  args.push("--", buildPrompt(input, mode));
  return args;
}

function buildPrompt(input: TaskBrief, mode: RunOptions["mode"]): string {
  return buildBoundedPrompt(
    input,
    mode,
    "",
    "- Do not create, invoke, or delegate to CodeBuddy sub-agents or nested agents."
  );
}

export function parseCodeBuddyJsonOutput(stdout: string): ParsedCliOutput | undefined {
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
        if (isRecord(event.usage)) {
          actualUsage = actualUsage ?? usageFromTokenObject(event.usage);
        }
        if (Array.isArray(event.permission_denials)) {
          permissionDenials.push(...event.permission_denials.map((item) => String(item)));
        }
      }

      if (event.type === "message" && event.role === "assistant" && !resultText) {
        resultText = assistantTextFromContent(event);
      }

      if (isRecord(event.providerData)) {
        if (isRecord(event.providerData.usage)) {
          actualUsage = actualUsage ?? usageFromTokenObject(event.providerData.usage);
        }
        if (isRecord(event.providerData.rawUsage)) {
          actualUsage = actualUsage ?? usageFromTokenObject(event.providerData.rawUsage);
        }
      }
    }

    return { resultText, actualUsage, permissionDenials };
  } catch {
    return undefined;
  }
}
