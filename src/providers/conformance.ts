import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { delegateTask } from "../core/delegate.js";
import { runCommand } from "../core/shell.js";
import type { TaskResult } from "../core/types.js";
import { getGitStatus } from "../worktrees/worktrees.js";

export type ProviderConformanceCheck = {
  name: string;
  ok: boolean;
  message: string;
  result?: TaskResult;
};

export async function runProviderConformance(provider: string): Promise<ProviderConformanceCheck[]> {
  const repoPath = await createConformanceRepo();
  const checks: ProviderConformanceCheck[] = [];

  checks.push(await runCheck("direct_read returns reviewable output without main worktree changes", async () => {
    const before = await getGitStatus(repoPath);
    const result = await delegateTask(
      {
        provider,
        mode: "direct_read",
        brief: {
          goal: "Summarize this tiny fixture repository for a SysTwo provider conformance check.",
          contextSummary: "The fixture contains math.js and test.js. Do not edit files.",
          preset: "summarize_codebase",
          permissions: ["read"],
          acceptanceCriteria: ["Return a short summary"],
          riskNotes: []
        }
      },
      repoPath
    );
    const after = await getGitStatus(repoPath);
    return {
      ok: result.status !== "failed" && before === after,
      message: result.status === "failed" ? result.summary : "direct_read completed without changing the main worktree.",
      result
    };
  }));

  checks.push(await runCheck("patch_only returns a non-empty patch proposal", async () => {
    const result = await delegateTask(
      {
        provider,
        mode: "patch_only",
        brief: {
          goal: "Draft a small patch proposal for fixing the fixture add function.",
          contextSummary: "math.js subtracts instead of adding. Do not edit files in patch_only mode.",
          preset: "draft_changes",
          permissions: ["read"],
          allowedFiles: ["math.js"],
          acceptanceCriteria: ["Return a patch proposal for math.js"],
          riskNotes: []
        }
      },
      repoPath
    );
    return {
      ok: result.status !== "failed" && Boolean(result.inlinePatch?.trim()),
      message: result.inlinePatch?.trim() ? "patch_only returned a patch proposal." : result.summary,
      result
    };
  }));

  checks.push(await runCheck("temp_worktree returns diff and passing test evidence", async () => {
    const result = await delegateTask(
      {
        provider,
        mode: "temp_worktree",
        preset: "fix_failures",
        brief: {
          goal: "Fix the failing add function test in this fixture repository.",
          contextSummary: "math.js subtracts instead of adding.",
          preset: "fix_failures",
          permissions: ["read", "temp_edit", "command"],
          allowedFiles: ["math.js"],
          acceptanceCriteria: ["node test.js passes", "Return diff evidence"],
          testCommand: "node test.js",
          riskNotes: []
        }
      },
      repoPath
    );
    return {
      ok:
        result.status !== "failed" &&
        Boolean(result.diffPath) &&
        Boolean(result.changedFiles?.length) &&
        result.testEvidence?.status === "passed",
      message:
        result.testEvidence?.status === "passed" && result.changedFiles?.length
          ? "temp_worktree returned diff evidence and passing test evidence."
          : result.summary,
      result
    };
  }));

  return checks;
}

async function runCheck(
  name: string,
  fn: () => Promise<Omit<ProviderConformanceCheck, "name">>
): Promise<ProviderConformanceCheck> {
  try {
    return { name, ...(await fn()) };
  } catch (error) {
    return {
      name,
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

async function createConformanceRepo(): Promise<string> {
  const repoPath = await mkdtemp(join(tmpdir(), "systwo-provider-conformance-"));
  await runCommand("git", ["init"], { cwd: repoPath });
  await writeFile(join(repoPath, "math.js"), ["export function add(a, b) {", "  return a - b;", "}", ""].join("\n"));
  await writeFile(
    join(repoPath, "test.js"),
    [
      "import { strict as assert } from 'node:assert';",
      "import { add } from './math.js';",
      "assert.equal(add(2, 3), 5);",
      ""
    ].join("\n")
  );
  await writeFile(join(repoPath, "package.json"), JSON.stringify({ type: "module" }, null, 2) + "\n");
  await writeFile(join(repoPath, ".gitignore"), ".systwo/\n");
  await runCommand("git", ["add", "."], { cwd: repoPath });
  await runCommand(
    "git",
    ["-c", "user.name=SysTwo Conformance", "-c", "user.email=conformance@systwo.local", "commit", "-m", "fixture"],
    { cwd: repoPath }
  );
  return repoPath;
}
