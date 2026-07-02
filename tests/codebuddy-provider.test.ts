import { describe, expect, it } from "vitest";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { delegateTask } from "../src/core/delegate.js";
import type { TaskBrief } from "../src/core/types.js";
import { buildCodeBuddyArgs, parseCodeBuddyJsonOutput, resolveCodeBuddyModelArgs } from "../src/providers/codebuddy/provider.js";
import { createFixtureRepo } from "./helpers/repo.js";

describe("CodeBuddy provider argument shape", () => {
  it("separates the prompt from variadic tool arguments", () => {
    const args = buildCodeBuddyArgs({
      goal: "Reply with exactly: SYSTWO_ARG_SHAPE_OK",
      contextSummary: "",
      permissions: ["read"],
      acceptanceCriteria: ["Return the requested text"]
    });

    const separatorIndex = args.indexOf("--");

    expect(args).toContain("--output-format");
    expect(args).toContain("json");
    expect(separatorIndex).toBeGreaterThan(args.indexOf("--disallowedTools"));
    expect(separatorIndex).toBe(args.length - 2);
    expect(args.at(-1)).toContain("SYSTWO_ARG_SHAPE_OK");
  });

  it("places the test command Bash tool before disallowed tools", () => {
    const args = buildCodeBuddyArgs({
      goal: "Fix the failing add function test.",
      contextSummary: "",
      permissions: ["read", "temp_edit", "command"],
      acceptanceCriteria: ["node test.js passes"],
      testCommand: "node test.js"
    });

    expect(args.indexOf("Bash(node test.js)")).toBeLessThan(args.indexOf("--disallowedTools"));
    expect(args.at(-2)).toBe("--");
    expect(args.at(-1)).toContain("Test command: node test.js");
  });

  it("keeps patch_only runs read-only at the tool boundary", () => {
    const args = buildCodeBuddyArgs(
      {
        goal: "Draft a small reviewable patch.",
        contextSummary: "",
        permissions: ["read"],
        acceptanceCriteria: ["Return a patch proposal"],
        testCommand: "npm test"
      },
      "patch_only"
    );

    expect(args).toContain("Read");
    expect(args).toContain("Grep");
    expect(args).toContain("Glob");
    expect(args).not.toContain("Edit");
    expect(args).not.toContain("Write");
    expect(args).not.toContain("Bash(npm test)");
    expect(args.at(-1)).toContain("Read-only filesystem mode");
    expect(args.at(-1)).toContain("Return a patch proposal");
    expect(args.at(-1)).not.toContain("Test command: npm test");
  });

  it("fails patch_only delegation when CodeBuddy returns no patch proposal", async () => {
    const repoPath = await createFixtureRepo();
    const binDir = await mkdtemp(join(tmpdir(), "systwo-codebuddy-bin-"));
    const fakeCodeBuddy = join(binDir, "codebuddy-empty-result.js");
    const previousBin = process.env.SYSTWO_CODEBUDDY_BIN;

    await writeFile(
      fakeCodeBuddy,
      [
        "#!/usr/bin/env node",
        'process.stdout.write(JSON.stringify({ type: "result", result: "" }));',
        ""
      ].join("\n")
    );
    await chmod(fakeCodeBuddy, 0o755);
    process.env.SYSTWO_CODEBUDDY_BIN = fakeCodeBuddy;

    try {
      const result = await delegateTask(
        {
          provider: "codebuddy",
          mode: "patch_only",
          brief: {
            goal: "Draft a concrete reviewable patch for the fixture.",
            contextSummary: "",
            preset: "draft_changes",
            permissions: ["read"],
            acceptanceCriteria: ["Return a patch proposal"]
          }
        },
        repoPath
      );

      expect(result.status).toBe("failed");
      expect(result.summary).toMatch(/returned no patch proposal/i);
      expect(result.riskNotes).toContain("Patch-only task returned no patch proposal.");
    } finally {
      if (previousBin === undefined) {
        delete process.env.SYSTWO_CODEBUDDY_BIN;
      } else {
        process.env.SYSTWO_CODEBUDDY_BIN = previousBin;
      }
    }
  });

  it("does not treat raw CodeBuddy json transcripts as patch proposals", async () => {
    const repoPath = await createFixtureRepo();
    const binDir = await mkdtemp(join(tmpdir(), "systwo-codebuddy-bin-"));
    const fakeCodeBuddy = join(binDir, "codebuddy-transcript-result.js");
    const previousBin = process.env.SYSTWO_CODEBUDDY_BIN;

    await writeFile(
      fakeCodeBuddy,
      [
        "#!/usr/bin/env node",
        "process.stdout.write(JSON.stringify([{",
        '  type: "message",',
        '  role: "user",',
        '  content: [{ type: "input_text", text: "<system-reminder>memory dump</system-reminder>" }]',
        "}]));",
        ""
      ].join("\n")
    );
    await chmod(fakeCodeBuddy, 0o755);
    process.env.SYSTWO_CODEBUDDY_BIN = fakeCodeBuddy;

    try {
      const result = await delegateTask(
        {
          provider: "codebuddy",
          mode: "patch_only",
          brief: {
            goal: "Draft a concrete reviewable patch for the fixture.",
            contextSummary: "",
            preset: "draft_changes",
            permissions: ["read"],
            acceptanceCriteria: ["Return a patch proposal"]
          }
        },
        repoPath
      );

      expect(result.status).toBe("failed");
      expect(result.summary).toMatch(/returned no patch proposal/i);
      expect(result.inlinePatch).toBeUndefined();
      expect(result.riskNotes).toContain("Patch-only task returned no patch proposal.");
    } finally {
      if (previousBin === undefined) {
        delete process.env.SYSTWO_CODEBUDDY_BIN;
      } else {
        process.env.SYSTWO_CODEBUDDY_BIN = previousBin;
      }
    }
  });

  it("does not pass model flags when CodeBuddy model policy is auto", () => {
    const resolution = resolveCodeBuddyModelArgs(
      {
        goal: "Summarize the repository structure.",
        contextSummary: "",
        preset: "summarize_codebase",
        permissions: ["read"],
        acceptanceCriteria: ["Return a concise summary"]
      },
      { mode: "auto", tiers: {} }
    );

    expect(resolution.ok).toBe(true);
    if (!resolution.ok) {
      return;
    }
    const args = buildCodeBuddyArgs(
      {
        goal: "Summarize the repository structure.",
        contextSummary: "",
        preset: "summarize_codebase",
        permissions: ["read"],
        acceptanceCriteria: ["Return a concise summary"]
      },
      "direct_read",
      resolution.args
    );

    expect(args).not.toContain("--model");
    expect(args).not.toContain("--fallback-model");
    expect(args).not.toContain("--effort");
  });

  it("passes configured model flags before the prompt separator", () => {
    const brief: TaskBrief = {
      goal: "Fix the failing concrete unit test.",
      contextSummary: "",
      preset: "fix_failures",
      permissions: ["read", "temp_edit", "command"],
      acceptanceCriteria: ["npm test passes"],
      testCommand: "npm test"
    };
    const resolution = resolveCodeBuddyModelArgs(brief, {
      mode: "hybrid",
      tiers: {
        high: {
          model: "deepseek-v4-pro",
          fallbackModel: "glm-5.0-turbo",
          effort: "high"
        }
      }
    });

    expect(resolution.ok).toBe(true);
    if (!resolution.ok) {
      return;
    }
    const args = buildCodeBuddyArgs(brief, "temp_worktree", resolution.args);
    const separatorIndex = args.indexOf("--");

    expect(args.indexOf("--model")).toBeGreaterThan(-1);
    expect(args.indexOf("--model")).toBeLessThan(separatorIndex);
    expect(args).toContain("deepseek-v4-pro");
    expect(args).toContain("--fallback-model");
    expect(args).toContain("glm-5.0-turbo");
    expect(args).toContain("--effort");
    expect(args).toContain("high");
  });

  it("falls back to auto only when hybrid has no configured tier", () => {
    const resolution = resolveCodeBuddyModelArgs(
      {
        goal: "Draft a small reviewable patch.",
        contextSummary: "",
        preset: "draft_changes",
        permissions: ["read"],
        acceptanceCriteria: ["Return a patch proposal"]
      },
      {
        mode: "hybrid",
        tiers: {
          high: { model: "deepseek-v4-pro" }
        }
      }
    );

    expect(resolution.ok).toBe(true);
    if (!resolution.ok) {
      return;
    }
    expect(resolution.args).toEqual([]);
    expect(resolution.riskNote).toMatch(/no medium tier is configured/i);
  });

  it("fails manual policy when the selected tier is missing", () => {
    const resolution = resolveCodeBuddyModelArgs(
      {
        goal: "Draft a small reviewable patch.",
        contextSummary: "",
        preset: "draft_changes",
        permissions: ["read"],
        acceptanceCriteria: ["Return a patch proposal"]
      },
      {
        mode: "manual",
        tiers: {
          high: { model: "deepseek-v4-pro" }
        }
      }
    );

    expect(resolution.ok).toBe(false);
    if (resolution.ok) {
      return;
    }
    expect(resolution.summary).toMatch(/requires a configured medium tier/i);
    expect(resolution.summary).toMatch(/did not fall back to auto/i);
  });

  it("fails explicit model policy when effort is invalid", () => {
    const resolution = resolveCodeBuddyModelArgs(
      {
        goal: "Fix the failing concrete unit test.",
        contextSummary: "",
        preset: "fix_failures",
        permissions: ["read", "temp_edit", "command"],
        acceptanceCriteria: ["npm test passes"],
        testCommand: "npm test"
      },
      {
        mode: "hybrid",
        tiers: {
          high: { model: "deepseek-v4-pro", effort: "heroic" as never }
        }
      }
    );

    expect(resolution.ok).toBe(false);
    if (resolution.ok) {
      return;
    }
    expect(resolution.summary).toMatch(/effort must be one of/i);
  });

  it("parses CodeBuddy json output for result text, usage, and permission denials", () => {
    const parsed = parseCodeBuddyJsonOutput(
      JSON.stringify([
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "fallback text" }]
        },
        {
          type: "result",
          subtype: "success",
          result: "final result text",
          usage: {
            input_tokens: 123,
            output_tokens: 45,
            total_tokens: 168,
            total_cost_usd: 0.01
          },
          permission_denials: ["Bash(grep -qx NEW greeting.txt)"]
        }
      ])
    );

    expect(parsed?.resultText).toBe("final result text");
    expect(parsed?.actualUsage).toEqual({
      source: "provider",
      inputTokens: 123,
      outputTokens: 45,
      totalTokens: 168,
      costUsd: 0.01
    });
    expect(parsed?.permissionDenials).toContain("Bash(grep -qx NEW greeting.txt)");
  });
});
