import { estimateUsageForBrief } from "../usage/usage.js";
import { defaultPermissionsForPreset, hasForbiddenGoalLanguage } from "../policy/policy.js";
import {
  RouteTaskInputSchema,
  type Permission,
  type Preset,
  type RouteTaskInput,
  type RouteTaskOutput
} from "../core/types.js";
import type { SysTwoConfig } from "../config/config.js";

export function routeTask(input: RouteTaskInput, config: SysTwoConfig): RouteTaskOutput {
  const parsed = RouteTaskInputSchema.parse(input);

  if (hasForbiddenGoalLanguage(parsed.goal)) {
    return {
      recommendedMode: "decline",
      permissions: ["read"],
      risk: "high",
      delegationValue: "low",
      friction: "none",
      estimatedUsage: estimateUsageForBrief({
        goal: parsed.goal,
        contextSummary: parsed.contextSummary ?? "",
        acceptanceCriteria: []
      }),
      rationale: "The request appears to ask for an operation outside the V0 safety floor.",
      requiresExplicitControllerCall: true
    };
  }

  const preset = inferPreset(parsed);
  const execution = recommendExecution(parsed, preset);
  const permissions = permissionsForRecommendation(preset, execution.recommendedExecutionMode);
  const risk = preset === "summarize_codebase" ? "low" : "medium";

  return {
    recommendedMode: execution.recommendedMode,
    recommendedPreset: preset,
    recommendedProvider: config.routing.defaultProvider,
    recommendedExecutionMode: execution.recommendedExecutionMode,
    delegationValue: execution.delegationValue,
    friction: execution.friction,
    permissions,
    risk,
    estimatedUsage: estimateUsageForBrief({
      goal: parsed.goal,
      contextSummary: parsed.contextSummary ?? "",
      acceptanceCriteria: parsed.knownConstraints ?? []
    }),
    rationale: execution.rationale,
    requiresExplicitControllerCall: true
  };
}

type RouteExecutionRecommendation = Pick<
  RouteTaskOutput,
  "recommendedMode" | "recommendedExecutionMode" | "delegationValue" | "friction" | "rationale"
>;

function recommendExecution(input: RouteTaskInput, preset: Preset): RouteExecutionRecommendation {
  if (preset === "summarize_codebase") {
    return {
      recommendedMode: "answer_directly",
      recommendedExecutionMode: "answer_directly",
      delegationValue: "low",
      friction: "none",
      rationale:
        "Read-only summarization is low risk and should usually be handled directly. Delegate only when the controller lacks enough context window or needs reusable evidence."
    };
  }

  if (preset === "draft_changes") {
    return {
      recommendedMode: input.desiredOutcome === "advice" ? "answer_directly" : "delegate",
      recommendedExecutionMode: input.desiredOutcome === "advice" ? "answer_directly" : "patch_only",
      delegationValue: input.desiredOutcome === "advice" ? "low" : "medium",
      friction: input.desiredOutcome === "advice" ? "none" : "patch_only",
      rationale:
        input.desiredOutcome === "advice"
          ? "Advice-only change requests should usually be answered directly."
          : "Patch drafting is bounded enough for delegation, and patch_only avoids temporary worktree setup while preserving review."
    };
  }

  return {
    recommendedMode: "delegate",
    recommendedExecutionMode: "temp_worktree",
    delegationValue: "high",
    friction: "worktree",
    rationale:
      "Failing-test fixes are worth delegation when bounded, and temp_worktree keeps runner edits isolated while preserving diff and test evidence."
  };
}

function permissionsForRecommendation(preset: Preset, executionMode?: string): Permission[] {
  if (executionMode === "answer_directly" || executionMode === "direct_read" || executionMode === "patch_only") {
    return ["read"];
  }
  return defaultPermissionsForPreset(preset);
}

function inferPreset(input: RouteTaskInput): Preset {
  if (input.desiredOutcome === "summary") {
    return "summarize_codebase";
  }
  if (input.desiredOutcome === "test_fix") {
    return "fix_failures";
  }
  if (input.desiredOutcome === "patch") {
    return "draft_changes";
  }
  const text = `${input.goal} ${input.contextSummary ?? ""}`.toLowerCase();
  if (matchesFixFailureLanguage(text)) {
    return "fix_failures";
  }
  if (matchesDraftChangeLanguage(text)) {
    return "draft_changes";
  }
  return "summarize_codebase";
}

function matchesFixFailureLanguage(text: string): boolean {
  return (
    /\b(test|failure|failing|lint|error|fix)\b/.test(text) ||
    /测试|单测|失败|报错|错误|异常|编译|构建|ci|红了|挂了/.test(text)
  );
}

function matchesDraftChangeLanguage(text: string): boolean {
  return (
    /\b(change|patch|edit|implement|refactor)\b/.test(text) ||
    /修改|更改|变更|实现|新增|添加|加上|删除|移除|重构|优化|调整|编辑|补丁|修复/.test(text)
  );
}
