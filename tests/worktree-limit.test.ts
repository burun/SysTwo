import { describe, expect, it } from "vitest";
import { defaultConfig } from "../src/config/config.js";
import { createTempWorktree, removeWorktree } from "../src/worktrees/worktrees.js";
import { createFixtureRepo } from "./helpers/repo.js";

describe("worktree concurrency limit", () => {
  it("refuses to create more temp worktrees than worktrees.maxConcurrent", async () => {
    const repoPath = await createFixtureRepo();
    const config = {
      ...defaultConfig,
      worktrees: { ...defaultConfig.worktrees, maxConcurrent: 1 }
    };

    const first = await createTempWorktree(repoPath, "trace-limit-1", config);
    await expect(createTempWorktree(repoPath, "trace-limit-2", config)).rejects.toThrow(/Worktree limit reached/);

    await removeWorktree(first);
    const afterCleanup = await createTempWorktree(repoPath, "trace-limit-3", config);
    await removeWorktree(afterCleanup);
  });
});
