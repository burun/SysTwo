import { SysTwoError } from "../core/errors.js";
import type { DelegateTaskInput, Permission, TaskBrief } from "../core/types.js";

const FORBIDDEN_GOAL_PATTERNS = [
  /\bcommit\b/i,
  /\bpush\b/i,
  /\bmerge\b/i,
  /\btag\b/i,
  /\brelease\b/i,
  /\bapply\s+result\b/i,
  /\bapply\s+patch\b/i,
  /\brm\s+-rf\b/i
];

export type PolicyDecision = {
  allowed: boolean;
  riskNotes: string[];
  networkAllowed: boolean;
};

export function isEditCapable(brief: TaskBrief): boolean {
  return brief.permissions.includes("temp_edit") || brief.preset === "draft_changes" || brief.preset === "fix_failures";
}

export function isTestCapable(brief: TaskBrief): boolean {
  return brief.preset === "fix_failures" || Boolean(brief.testCommand);
}

export function validateTaskBriefForDelegation(input: DelegateTaskInput): PolicyDecision {
  const brief = input.brief;
  const riskNotes = [...(brief.riskNotes ?? [])];
  const goalAndContext = `${brief.goal}\n${brief.contextSummary ?? ""}`;

  if (FORBIDDEN_GOAL_PATTERNS.some((pattern) => pattern.test(goalAndContext))) {
    throw new SysTwoError(
      "Task asks for an operation outside the V0 safety floor.",
      "POLICY_FORBIDDEN_OPERATION"
    );
  }

  if (brief.permissions.includes("network")) {
    riskNotes.push("Network permission was requested, but V0 policy keeps network disabled by default.");
  }

  if (isEditCapable(brief)) {
    if (input.mode !== "temp_worktree" && input.mode !== "patch_only") {
      throw new SysTwoError(
        "Edit-capable tasks must use temp_worktree or patch_only mode.",
        "POLICY_EDIT_MODE"
      );
    }
    if (input.mode === "temp_worktree" && !brief.permissions.includes("temp_edit")) {
      throw new SysTwoError("temp_worktree edit-capable tasks require temp_edit permission.", "POLICY_TEMP_EDIT_REQUIRED");
    }
    if (brief.acceptanceCriteria.length === 0) {
      throw new SysTwoError("Edit-capable tasks require non-empty acceptance criteria.", "POLICY_ACCEPTANCE_REQUIRED");
    }
  }

  if (brief.preset === "fix_failures" && !brief.testCommand && !brief.failingLogSummary && brief.acceptanceCriteria.length === 0) {
    throw new SysTwoError(
      "fix_failures requires a testCommand, failing log summary, or explicit acceptance criteria.",
      "POLICY_FIX_FAILURES_BOUNDS"
    );
  }

  return {
    allowed: true,
    riskNotes,
    networkAllowed: false
  };
}

export function defaultPermissionsForPreset(preset?: string): Permission[] {
  if (preset === "draft_changes" || preset === "fix_failures") {
    return ["read", "temp_edit", "command"];
  }
  if (preset === "summarize_codebase") {
    return ["read"];
  }
  return ["read"];
}

export function hasForbiddenGoalLanguage(goal: string): boolean {
  return FORBIDDEN_GOAL_PATTERNS.some((pattern) => pattern.test(goal));
}
