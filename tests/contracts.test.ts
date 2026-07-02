import { describe, expect, it } from "vitest";
import { delegateTask } from "../src/core/delegate.js";
import { DelegateTaskInputSchema } from "../src/core/types.js";
import { validateTaskBriefForDelegation } from "../src/policy/policy.js";
import { createFixtureRepo } from "./helpers/repo.js";

describe("contracts and policy validation", () => {
  it("rejects vague goals at schema boundary", () => {
    expect(() =>
      DelegateTaskInputSchema.parse({
        brief: { goal: "fix", contextSummary: "", permissions: ["read"], acceptanceCriteria: [] }
      })
    ).toThrow();
  });

  it("requires acceptance criteria for edit-capable tasks", () => {
    const input = DelegateTaskInputSchema.parse({
      mode: "temp_worktree",
      brief: {
        goal: "Fix a concrete failing test",
        contextSummary: "",
        preset: "fix_failures",
        permissions: ["read", "temp_edit", "command"],
        acceptanceCriteria: [],
        testCommand: "node test.js"
      }
    });
    expect(() => validateTaskBriefForDelegation(input)).toThrow(/acceptance/i);
  });

  it("rejects direct_read for edit-capable tasks", () => {
    const input = DelegateTaskInputSchema.parse({
      mode: "direct_read",
      brief: {
        goal: "Draft a concrete source change",
        contextSummary: "",
        preset: "draft_changes",
        permissions: ["read"],
        acceptanceCriteria: ["Return a reviewable patch"]
      }
    });
    expect(() => validateTaskBriefForDelegation(input)).toThrow(/temp_worktree or patch_only/i);
  });

  it("blocks forbidden git operations", () => {
    const input = DelegateTaskInputSchema.parse({
      mode: "temp_worktree",
      brief: {
        goal: "Commit and push these changes",
        contextSummary: "",
        permissions: ["read", "temp_edit"],
        acceptanceCriteria: ["Do the unsafe thing"]
      }
    });
    expect(() => validateTaskBriefForDelegation(input)).toThrow(/outside the V0 safety floor/i);
  });

  it("rejects explicit unknown providers instead of falling back to mock", async () => {
    const repoPath = await createFixtureRepo();

    await expect(
      delegateTask(
        {
          provider: "typo-provider",
          mode: "direct_read",
          brief: {
            goal: "Summarize this repository in a bounded way.",
            contextSummary: "",
            preset: "summarize_codebase",
            permissions: ["read"],
            acceptanceCriteria: ["Return a summary"]
          }
        },
        repoPath
      )
    ).rejects.toThrow(/Unknown provider "typo-provider"/);
  });
});
