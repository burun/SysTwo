import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Provider, RunOptions, TaskBrief, TaskResult } from "../../core/types.js";
import { estimateUsageForBrief, unavailableActualUsage } from "../../usage/usage.js";
import { runTestCommand } from "../../worktrees/worktrees.js";

export const mockProvider: Provider = {
  id: "mock",
  displayName: "Mock Provider",
  capabilities: ["code_search", "log_summary", "draft_patch", "test_retry", "mechanical_fix"],
  async estimateUsage(input: TaskBrief) {
    return estimateUsageForBrief(input);
  },
  async doctor() {
    return { ok: true, message: "Mock provider is available." };
  },
  async runTask(input: TaskBrief, options: RunOptions): Promise<TaskResult> {
    const cwd = options.worktreePath ?? options.repoPath;
    const estimated = estimateUsageForBrief(input);
    const riskNotes = [
      ...(input.riskNotes ?? []),
      "Mock provider is deterministic and local; it does not contact external services.",
      "Network isolation is enforced at policy level only in V0."
    ];

    if (options.mode === "patch_only") {
      return {
        status: "needs_review",
        summary: "Mock provider produced a patch-only proposal.",
        provider: "mock",
        traceId: options.traceId,
        inlinePatch: createPatchOnlyProposal(input),
        usage: { estimated, actual: unavailableActualUsage() },
        riskNotes
      };
    }

    if (input.preset === "summarize_codebase") {
      return {
        status: "success",
        summary: "Mock provider summarized the bounded task without editing files.",
        provider: "mock",
        traceId: options.traceId,
        worktreePath: options.worktreePath,
        usage: { estimated, actual: unavailableActualUsage() },
        riskNotes
      };
    }

    await applyDeterministicChange(cwd, input);
    let testEvidence = undefined;
    if (input.testCommand) {
      const test = await runTestCommand(input.testCommand, cwd);
      const outputPath = join(cwd, ".systwo-test-output.txt");
      await writeFile(outputPath, test.output || "(no output)");
      testEvidence = {
        command: input.testCommand,
        status: test.status,
        exitCode: test.exitCode,
        outputSummary: summarizeOutput(test.output),
        outputPath
      } as const;
    }

    return {
      status: testEvidence?.status === "failed" ? "failed" : "success",
      summary: "Mock provider completed the delegated task in the temporary worktree.",
      provider: "mock",
      traceId: options.traceId,
      worktreePath: options.worktreePath,
      testEvidence,
      usage: { estimated, actual: unavailableActualUsage() },
      riskNotes
    };
  }
};

async function applyDeterministicChange(cwd: string, input: TaskBrief): Promise<void> {
  const allowedFiles = input.allowedFiles ?? ["math.js", "src/math.js", "README.md"];
  for (const file of allowedFiles) {
    const path = join(cwd, file);
    try {
      const current = await readFile(path, "utf8");
      const next = current
        .replace("return a - b;", "return a + b;")
        .replace("return left - right;", "return left + right;");
      if (next !== current) {
        await writeFile(path, next);
        return;
      }
    } catch {
      // Try the next allowed file.
    }
  }

  await mkdir(join(cwd, "systwo-output"), { recursive: true });
  await writeFile(
    join(cwd, "systwo-output", "mock-change.txt"),
    `Goal: ${input.goal}\nAcceptance criteria:\n${input.acceptanceCriteria.map((item) => `- ${item}`).join("\n")}\n`
  );
}

function createPatchOnlyProposal(input: TaskBrief): string {
  return [
    "Patch-only proposal from mock provider.",
    `Goal: ${input.goal}`,
    "No files were mutated because mode=patch_only."
  ].join("\n");
}

function summarizeOutput(output: string): string {
  const trimmed = output.trim();
  if (!trimmed) {
    return "(no output)";
  }
  return trimmed.length > 600 ? `${trimmed.slice(0, 600)}...` : trimmed;
}
