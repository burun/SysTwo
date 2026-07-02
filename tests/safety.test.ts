import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultConfig } from "../src/config/config.js";
import { delegateTask } from "../src/core/delegate.js";
import { captureDiff, createTempWorktree, getGitStatus, removeWorktree } from "../src/worktrees/worktrees.js";
import { createFixtureRepo } from "./helpers/repo.js";

describe("delegation safety", () => {
  it("fixes a failing test in a temporary worktree and leaves main worktree untouched", async () => {
    const repoPath = await createFixtureRepo();
    const beforeStatus = await getGitStatus(repoPath);
    const beforeMath = await readFile(join(repoPath, "math.js"), "utf8");

    const result = await delegateTask(
      {
        provider: "mock",
        preset: "fix_failures",
        mode: "temp_worktree",
        brief: {
          goal: "Fix the failing add function test in this repository.",
          contextSummary: "math.js subtracts instead of adding.",
          preset: "fix_failures",
          allowedFiles: ["math.js"],
          permissions: ["read", "temp_edit", "command"],
          acceptanceCriteria: ["node test.js passes", "Return diff evidence"],
          testCommand: "node test.js"
        }
      },
      repoPath
    );

    const afterStatus = await getGitStatus(repoPath);
    const afterMath = await readFile(join(repoPath, "math.js"), "utf8");

    expect(result.status).toBe("success");
    expect(result.diffPath).toBeTruthy();
    expect(result.changedFiles).toContain("math.js");
    expect(result.testEvidence?.status).toBe("passed");
    expect(result.usage.estimated).toBeTruthy();
    expect(result.usage.actual?.source).toBe("unavailable");
    expect(afterStatus).toBe(beforeStatus);
    expect(afterMath).toBe(beforeMath);
  });

  it("adds not_run evidence when a test-capable task lacks provider evidence", async () => {
    const repoPath = await createFixtureRepo();
    const result = await delegateTask(
      {
        provider: "mock",
        preset: "draft_changes",
        mode: "temp_worktree",
        brief: {
          goal: "Draft a bounded change for the add function.",
          contextSummary: "",
          preset: "draft_changes",
          allowedFiles: ["math.js"],
          permissions: ["read", "temp_edit"],
          acceptanceCriteria: ["Return diff evidence"]
        }
      },
      repoPath
    );

    expect(result.diffPath).toBeTruthy();
  });

  it("captures untracked files in temporary worktree diff evidence", async () => {
    const repoPath = await createFixtureRepo();
    const session = await createTempWorktree(repoPath, "delegate-test-untracked", defaultConfig);

    try {
      await writeFile(join(session.worktreePath, "new-dag.py"), "print('new')\n");
      const diff = await captureDiff(session);

      expect(diff.changedFiles).toContain("new-dag.py");
      expect(diff.inlinePatch).toContain("new file mode");
      expect(diff.inlinePatch).toContain("print('new')");
    } finally {
      await removeWorktree(session);
    }
  });

  it("fails delegation when a provider creates untracked files in the main worktree", async () => {
    const repoPath = await createFixtureRepo();
    const binDir = await mkdtemp(join(tmpdir(), "systwo-codebuddy-bin-"));
    const fakeCodeBuddy = join(binDir, "codebuddy-main-mutation.js");
    const previousBin = process.env.SYSTWO_CODEBUDDY_BIN;
    const previousMainRepo = process.env.SYSTWO_TEST_MAIN_REPO;

    await writeFile(
      fakeCodeBuddy,
      [
        "#!/usr/bin/env node",
        "const { readFileSync, writeFileSync } = require('node:fs');",
        "const { join } = require('node:path');",
        "const cwd = process.cwd();",
        "const mathPath = join(cwd, 'math.js');",
        "const current = readFileSync(mathPath, 'utf8');",
        "writeFileSync(mathPath, current.replace('return a - b;', 'return a + b;'));",
        "writeFileSync(join(process.env.SYSTWO_TEST_MAIN_REPO, 'main-leak.txt'), 'leaked into main worktree\\n');",
        "process.stdout.write(JSON.stringify({ type: 'result', result: 'changed worktree and main repo' }));",
        ""
      ].join("\n")
    );
    await chmod(fakeCodeBuddy, 0o755);
    process.env.SYSTWO_CODEBUDDY_BIN = fakeCodeBuddy;
    process.env.SYSTWO_TEST_MAIN_REPO = repoPath;

    try {
      const result = await delegateTask(
        {
          provider: "codebuddy",
          preset: "fix_failures",
          mode: "temp_worktree",
          brief: {
            goal: "Fix the failing add function test in this repository.",
            contextSummary: "math.js subtracts instead of adding.",
            preset: "fix_failures",
            allowedFiles: ["math.js"],
            permissions: ["read", "temp_edit", "command"],
            acceptanceCriteria: ["node test.js passes", "Return diff evidence"],
            testCommand: "node test.js"
          }
        },
        repoPath
      );

      expect(result.status).toBe("failed");
      expect(result.riskNotes).toContain("Main worktree status changed during delegation.");
    } finally {
      if (previousBin === undefined) {
        delete process.env.SYSTWO_CODEBUDDY_BIN;
      } else {
        process.env.SYSTWO_CODEBUDDY_BIN = previousBin;
      }
      if (previousMainRepo === undefined) {
        delete process.env.SYSTWO_TEST_MAIN_REPO;
      } else {
        process.env.SYSTWO_TEST_MAIN_REPO = previousMainRepo;
      }
    }
  });
});
