import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../config/config.js";
import { delegateTask } from "../core/delegate.js";
import { runCommand } from "../core/shell.js";
import type { TaskResult } from "../core/types.js";
import { routeTask } from "../router/router.js";
import { getGitStatus } from "../worktrees/worktrees.js";
import { readLedger, summarizeLedger, type UsageReport } from "../usage/ledger.js";

export type DemoResult = {
  repoPath: string;
  route: ReturnType<typeof routeTask>;
  result: TaskResult;
  usageReport: UsageReport;
  mainWorktreeUnchanged: boolean;
};

export async function createDemoRepository(): Promise<string> {
  const repoPath = await mkdtemp(join(tmpdir(), "systwo-demo-"));
  await runCommand("git", ["init"], { cwd: repoPath });
  await writeFile(
    join(repoPath, "math.js"),
    [
      "export function add(a, b) {",
      "  return a - b;",
      "}",
      ""
    ].join("\n")
  );
  await writeFile(
    join(repoPath, "test.js"),
    [
      "import { strict as assert } from 'node:assert';",
      "import { add } from './math.js';",
      "assert.equal(add(2, 3), 5);",
      "console.log('demo test passed');",
      ""
    ].join("\n")
  );
  await writeFile(join(repoPath, "package.json"), JSON.stringify({ type: "module" }, null, 2) + "\n");
  await writeFile(join(repoPath, ".gitignore"), ".systwo/\n");
  await runCommand("git", ["add", "."], { cwd: repoPath });
  await runCommand(
    "git",
    ["-c", "user.name=SysTwo Demo", "-c", "user.email=demo@systwo.local", "commit", "-m", "demo fixture"],
    { cwd: repoPath }
  );
  return repoPath;
}

export async function runDemo(): Promise<DemoResult> {
  const repoPath = await createDemoRepository();
  const config = loadConfig(repoPath);
  const before = await getGitStatus(repoPath);
  const route = routeTask(
    {
      goal: "Fix the failing add function test in the demo repository.",
      repoPath,
      desiredOutcome: "test_fix",
      knownConstraints: ["Do not edit the main worktree.", "Return diff and test evidence."]
    },
    config
  );
  const result = await delegateTask(
    {
      provider: "mock",
      preset: "fix_failures",
      mode: "temp_worktree",
      brief: {
        goal: "Fix the failing add function test in the demo repository.",
        contextSummary: "The demo repository has math.js and test.js. node test.js currently fails.",
        preset: "fix_failures",
        allowedFiles: ["math.js"],
        permissions: ["read", "temp_edit", "command"],
        acceptanceCriteria: ["node test.js passes", "Return a diff for review", "Do not mutate the main worktree"],
        testCommand: "node test.js",
        riskNotes: []
      }
    },
    repoPath
  );
  const after = await getGitStatus(repoPath);
  const usageReport = summarizeLedger(await readLedger(repoPath), config);
  return {
    repoPath,
    route,
    result,
    usageReport,
    mainWorktreeUnchanged: before === after
  };
}
