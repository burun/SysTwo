import { loadConfig } from "../config/config.js";
import { routeTask } from "../router/router.js";
import { delegateTask } from "./delegate.js";
import {
  RouteThenDelegateInputSchema,
  type DelegateTaskInput,
  type RouteTaskOutput,
  type RouteThenDelegateInput,
  type TaskResult
} from "./types.js";

export type RouteThenDelegateResult =
  | {
      status: "delegated";
      route: RouteTaskOutput;
      result: TaskResult;
    }
  | {
      status: "not_delegated";
      route: RouteTaskOutput;
      reason: string;
    };

export async function routeThenDelegateTask(
  rawInput: RouteThenDelegateInput,
  repoPath = process.cwd()
): Promise<RouteThenDelegateResult> {
  const input = RouteThenDelegateInputSchema.parse(rawInput);
  const effectiveRepoPath = input.repoPath ?? repoPath;
  const config = loadConfig(effectiveRepoPath);
  const route = routeTask(
    {
      goal: input.goal,
      contextSummary: input.contextSummary,
      repoPath: input.repoPath,
      knownConstraints: input.knownConstraints,
      desiredOutcome: input.desiredOutcome
    },
    config
  );

  if (route.recommendedMode !== "delegate") {
    return {
      status: "not_delegated",
      route,
      reason: `Route recommended ${route.recommendedMode}, so no provider was invoked.`
    };
  }

  if (route.delegationValue !== "high") {
    return {
      status: "not_delegated",
      route,
      reason: `Route delegation value is ${route.delegationValue}; automatic delegation requires high value.`
    };
  }

  if (!route.recommendedPreset || !isDelegateMode(route.recommendedExecutionMode)) {
    return {
      status: "not_delegated",
      route,
      reason: "Route did not produce a delegate-capable preset and execution mode."
    };
  }

  const delegateInput: DelegateTaskInput = {
    provider: input.provider ?? route.recommendedProvider,
    preset: route.recommendedPreset,
    mode: route.recommendedExecutionMode,
    brief: {
      goal: input.goal,
      contextSummary: input.contextSummary ?? "",
      preset: route.recommendedPreset,
      allowedFiles: input.allowedFiles,
      permissions: input.permissions ?? route.permissions,
      acceptanceCriteria: acceptanceCriteriaFor(input),
      testCommand: input.testCommand,
      failingLogSummary: input.failingLogSummary,
      riskNotes: input.riskNotes
    }
  };

  const result = await delegateTask(delegateInput, effectiveRepoPath);
  return { status: "delegated", route, result };
}

function isDelegateMode(mode: RouteTaskOutput["recommendedExecutionMode"]): mode is DelegateTaskInput["mode"] {
  return mode === "direct_read" || mode === "temp_worktree" || mode === "patch_only";
}

function acceptanceCriteriaFor(input: RouteThenDelegateInput): string[] {
  if (input.acceptanceCriteria && input.acceptanceCriteria.length > 0) {
    return input.acceptanceCriteria;
  }
  if (input.knownConstraints && input.knownConstraints.length > 0) {
    return input.knownConstraints;
  }
  if (input.testCommand) {
    return [`The test command passes: ${input.testCommand}`];
  }
  if (input.failingLogSummary) {
    return ["The described failure is addressed."];
  }
  return [];
}
