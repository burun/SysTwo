import { z } from "zod";
import type { SysTwoConfig } from "../config/config.js";

export const PermissionSchema = z.enum(["read", "temp_edit", "command", "network"]);
export type Permission = z.infer<typeof PermissionSchema>;

export const PresetSchema = z.enum(["summarize_codebase", "draft_changes", "fix_failures"]);
export type Preset = z.infer<typeof PresetSchema>;

export const UsageEstimateSchema = z.object({
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative().optional(),
  estimatedCostUsd: z.number().nonnegative().optional(),
  confidence: z.enum(["low", "medium", "high"]),
  basis: z.string().min(1)
});
export type UsageEstimate = z.infer<typeof UsageEstimateSchema>;

export const UsageActualSchema = z.object({
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
  source: z.enum(["provider", "runner_log", "unavailable"])
});
export type UsageActual = z.infer<typeof UsageActualSchema>;

export const TestEvidenceSchema = z.object({
  command: z.string().min(1),
  status: z.enum(["passed", "failed", "not_run"]),
  exitCode: z.number().int().optional(),
  outputSummary: z.string().min(1),
  outputPath: z.string().optional()
});
export type TestEvidence = z.infer<typeof TestEvidenceSchema>;

export const TaskBriefSchema = z.object({
  goal: z.string().trim().min(8, "goal must be concrete"),
  contextSummary: z.string().default(""),
  preset: PresetSchema.optional(),
  allowedFiles: z.array(z.string().min(1)).optional(),
  permissions: z.array(PermissionSchema).default(["read"]),
  acceptanceCriteria: z.array(z.string().min(1)).default([]),
  testCommand: z.string().min(1).optional(),
  failingLogSummary: z.string().min(1).optional(),
  riskNotes: z.array(z.string()).default([])
});
export type TaskBrief = z.infer<typeof TaskBriefSchema>;

export const DelegateTaskInputSchema = z.object({
  brief: TaskBriefSchema,
  provider: z.string().min(1).optional(),
  preset: PresetSchema.optional(),
  mode: z.enum(["direct_read", "temp_worktree", "patch_only"]).default("temp_worktree")
});
export type DelegateTaskInput = z.infer<typeof DelegateTaskInputSchema>;

export const RouteTaskInputSchema = z.object({
  goal: z.string().trim().min(3),
  contextSummary: z.string().optional(),
  repoPath: z.string().optional(),
  knownConstraints: z.array(z.string()).optional(),
  desiredOutcome: z.enum(["advice", "patch", "test_fix", "summary"]).optional()
});
export type RouteTaskInput = z.infer<typeof RouteTaskInputSchema>;

export const RouteThenDelegateInputSchema = RouteTaskInputSchema.extend({
  provider: z.string().min(1).optional(),
  allowedFiles: z.array(z.string().min(1)).optional(),
  permissions: z.array(PermissionSchema).optional(),
  acceptanceCriteria: z.array(z.string().min(1)).optional(),
  testCommand: z.string().min(1).optional(),
  failingLogSummary: z.string().min(1).optional(),
  riskNotes: z.array(z.string()).default([])
});
export type RouteThenDelegateInput = z.infer<typeof RouteThenDelegateInputSchema>;

export const RouteTaskOutputSchema = z.object({
  recommendedMode: z.enum(["answer_directly", "delegate", "decline"]),
  recommendedPreset: PresetSchema.optional(),
  recommendedProvider: z.string().optional(),
  recommendedExecutionMode: z.enum(["answer_directly", "direct_read", "patch_only", "temp_worktree"]).optional(),
  delegationValue: z.enum(["low", "medium", "high"]),
  friction: z.enum(["none", "patch_only", "worktree"]),
  permissions: z.array(PermissionSchema),
  risk: z.enum(["low", "medium", "high"]),
  estimatedUsage: UsageEstimateSchema,
  rationale: z.string(),
  requiresExplicitControllerCall: z.boolean()
});
export type RouteTaskOutput = z.infer<typeof RouteTaskOutputSchema>;

export const TaskResultSchema = z.object({
  status: z.enum(["success", "failed", "needs_review"]),
  summary: z.string(),
  provider: z.string(),
  model: z.string().optional(),
  modelTier: z.enum(["low", "medium", "high"]).optional(),
  traceId: z.string(),
  worktreePath: z.string().optional(),
  diffPath: z.string().optional(),
  inlinePatch: z.string().optional(),
  changedFiles: z.array(z.string()).optional(),
  testEvidence: TestEvidenceSchema.optional(),
  usage: z.object({
    estimated: UsageEstimateSchema.optional(),
    actual: UsageActualSchema.optional()
  }),
  delegatedUsageSummary: z.string().optional(),
  riskNotes: z.array(z.string())
});
export type TaskResult = z.infer<typeof TaskResultSchema>;

export type ProviderCapability =
  | "code_search"
  | "log_summary"
  | "draft_patch"
  | "test_retry"
  | "mechanical_fix";

export type RunOptions = {
  repoPath: string;
  worktreePath?: string;
  mode: "direct_read" | "temp_worktree" | "patch_only";
  timeoutMs?: number;
  networkAllowed: boolean;
  traceId: string;
  config?: SysTwoConfig;
};

export type ProviderDoctorResult = {
  ok: boolean;
  message: string;
  details?: Record<string, unknown>;
};

export interface Provider {
  id: string;
  displayName: string;
  capabilities: ProviderCapability[];
  estimateUsage(input: TaskBrief): Promise<UsageEstimate>;
  runTask(input: TaskBrief, options: RunOptions): Promise<TaskResult>;
  doctor?(): Promise<ProviderDoctorResult>;
}
