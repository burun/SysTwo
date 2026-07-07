import { loadConfig } from "../config/config.js";
import { createTraceId } from "./ids.js";
import {
  DelegateTaskInputSchema,
  type DelegateTaskInput,
  type TaskResult,
  TaskResultSchema
} from "./types.js";
import { appendTraceEvent } from "../traces/traces.js";
import { validateTaskBriefForDelegation, isEditCapable, isTestCapable } from "../policy/policy.js";
import {
  captureDiff,
  createTempWorktree,
  getGitStatus,
  removeWorktree,
  runTestCommand,
  type WorktreeSession
} from "../worktrees/worktrees.js";
import { getProvider } from "../providers/registry.js";
import { SysTwoError } from "./errors.js";
import { formatDelegatedUsageSummary } from "../usage/summary.js";
import { appendLedgerEntry } from "../usage/ledger.js";

export async function delegateTask(rawInput: DelegateTaskInput, repoPath = process.cwd()): Promise<TaskResult> {
  const input = DelegateTaskInputSchema.parse(rawInput);
  const normalizedInput: DelegateTaskInput = {
    ...input,
    brief: {
      ...input.brief,
      preset: input.brief.preset ?? input.preset
    }
  };
  const config = loadConfig(repoPath);
  const policy = validateTaskBriefForDelegation(normalizedInput);
  const provider = getProvider(normalizedInput.provider ?? config.routing.defaultProvider);
  const traceId = createTraceId("delegate");
  const mainStatusBefore = await getGitStatus(repoPath);
  let session: WorktreeSession | undefined;

  await appendTraceEvent(repoPath, {
    traceId,
    type: "delegate.start",
    payload: { input: normalizedInput, provider: provider.id, policy }
  });

  try {
    if (isEditCapable(normalizedInput.brief) && normalizedInput.mode === "temp_worktree") {
      session = await createTempWorktree(repoPath, traceId, config);
    }

    const result = await provider.runTask(normalizedInput.brief, {
      repoPath,
      worktreePath: session?.worktreePath,
      mode: normalizedInput.mode,
      networkAllowed: policy.networkAllowed,
      traceId,
      config
    });

    let finalResult: TaskResult = {
      ...result,
      traceId,
      provider: provider.id,
      worktreePath: session?.worktreePath ?? result.worktreePath,
      riskNotes: [...policy.riskNotes, ...(result.riskNotes ?? [])]
    };

    if (session && isEditCapable(normalizedInput.brief)) {
      const diff = await captureDiff(session);
      if (diff.changedFiles.length === 0) {
        finalResult = {
          ...finalResult,
          status: finalResult.status === "success" ? "needs_review" : finalResult.status,
          riskNotes: [...finalResult.riskNotes, "Edit-capable task produced no diff evidence."]
        };
      }
      finalResult.diffPath = diff.diffPath;
      finalResult.inlinePatch = diff.inlinePatch;
      finalResult.changedFiles = diff.changedFiles;
    }

    if (session && normalizedInput.brief.testCommand && normalizedInput.mode === "temp_worktree") {
      const evidence = await runTestCommand(normalizedInput.brief.testCommand, session.worktreePath);
      finalResult.testEvidence = {
        command: normalizedInput.brief.testCommand,
        status: evidence.status,
        exitCode: evidence.exitCode,
        outputSummary: summarizeTestOutput(evidence.output)
      };
      if (evidence.status === "failed") {
        finalResult = {
          ...finalResult,
          status: "failed"
        };
      }
    }

    if (isEditCapable(normalizedInput.brief) && normalizedInput.mode === "patch_only" && !hasPatchProposal(finalResult.inlinePatch)) {
      finalResult = {
        ...finalResult,
        status: "failed",
        riskNotes: [...finalResult.riskNotes, "Patch-only task returned no patch proposal."]
      };
    }
    if (isEditCapable(normalizedInput.brief) && !finalResult.diffPath && normalizedInput.mode !== "patch_only") {
      throw new SysTwoError("Edit-capable task did not return diff evidence.", "RESULT_DIFF_REQUIRED");
    }
    if (isTestCapable(normalizedInput.brief) && !finalResult.testEvidence) {
      finalResult.testEvidence = {
        command: normalizedInput.brief.testCommand ?? "(not provided)",
        status: "not_run",
        outputSummary: "Provider did not run tests or no test command was supplied."
      };
    }
    finalResult.delegatedUsageSummary = formatDelegatedUsageSummary(finalResult);

    const mainStatusAfter = await getGitStatus(repoPath);
    if (mainStatusAfter !== mainStatusBefore) {
      finalResult = {
        ...finalResult,
        status: "failed",
        riskNotes: [...finalResult.riskNotes, "Main worktree status changed during delegation."]
      };
    }

    const parsed = TaskResultSchema.parse(finalResult);
    await appendTraceEvent(repoPath, {
      traceId,
      type: "delegate.result",
      payload: parsed
    });
    await appendLedgerEntry(repoPath, {
      traceId,
      timestamp: new Date().toISOString(),
      provider: provider.id,
      preset: normalizedInput.brief.preset,
      mode: normalizedInput.mode,
      status: parsed.status,
      estimated: parsed.usage.estimated,
      actual: parsed.usage.actual,
      briefOverheadTokens: parsed.usage.estimated?.inputTokens ?? 0
    });

    if (session && parsed.status === "success" && config.worktrees.cleanup === "on_success") {
      await removeWorktree(session);
    }

    return parsed;
  } catch (error) {
    await appendTraceEvent(repoPath, {
      traceId,
      type: "delegate.error",
      payload: { message: error instanceof Error ? error.message : String(error) }
    });
    throw error;
  }
}

function summarizeTestOutput(output: string): string {
  const trimmed = output.trim();
  if (!trimmed) {
    return "Command completed without output.";
  }
  return trimmed.length > 2000 ? `${trimmed.slice(0, 2000)}...` : trimmed;
}

function hasPatchProposal(inlinePatch: string | undefined): boolean {
  return Boolean(inlinePatch?.trim());
}
