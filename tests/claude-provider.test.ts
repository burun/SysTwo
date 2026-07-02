import { describe, expect, it } from "vitest";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { delegateTask } from "../src/core/delegate.js";
import type { TaskBrief } from "../src/core/types.js";
import { buildClaudeArgs, parseClaudeJsonOutput, resolveClaudeModelArgs } from "../src/providers/claude/provider.js";
import { createFixtureRepo } from "./helpers/repo.js";

describe("Claude Code provider argument shape", () => {
  it("uses print/json mode and separates the prompt from variadic tool arguments", () => {
    const args = buildClaudeArgs({
      goal: "Reply with exactly: SYSTWO_CLAUDE_ARG_SHAPE_OK",
      contextSummary: "",
      permissions: ["read"],
      acceptanceCriteria: ["Return the requested text"]
    });

    const separatorIndex = args.indexOf("--");

    expect(args).toContain("-p");
    expect(args).toContain("--output-format");
    expect(args).toContain("json");
    expect(args).toContain("--tools");
    expect(args).toContain("Read,Edit,Write,Grep,Glob,Bash");
    expect(separatorIndex).toBeGreaterThan(args.indexOf("--disallowedTools"));
    expect(separatorIndex).toBe(args.length - 2);
    expect(args.at(-1)).toContain("SYSTWO_CLAUDE_ARG_SHAPE_OK");
  });

  it("keeps patch_only runs read-only at the Claude tool boundary", () => {
    const args = buildClaudeArgs(
      {
        goal: "Draft a small reviewable patch.",
        contextSummary: "",
        permissions: ["read"],
        acceptanceCriteria: ["Return a patch proposal"],
        testCommand: "npm test"
      },
      "patch_only"
    );

    const toolsIndex = args.indexOf("--tools");
    expect(args.at(toolsIndex + 1)).toBe("Read,Grep,Glob");
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

  it("allows only the configured test command as a Bash auto-approved tool", () => {
    const args = buildClaudeArgs({
      goal: "Fix the failing add function test.",
      contextSummary: "",
      permissions: ["read", "temp_edit", "command"],
      acceptanceCriteria: ["node test.js passes"],
      testCommand: "node test.js"
    });

    expect(args).toContain("Read,Edit,Write,Grep,Glob,Bash");
    expect(args.indexOf("Bash(node test.js)")).toBeLessThan(args.indexOf("--disallowedTools"));
    expect(args.at(-1)).toContain("Test command: node test.js");
  });

  it("fails patch_only delegation when Claude Code returns no patch proposal", async () => {
    const repoPath = await createFixtureRepo();
    const binDir = await mkdtemp(join(tmpdir(), "systwo-claude-bin-"));
    const fakeClaude = join(binDir, "claude-empty-result.js");
    const previousBin = process.env.SYSTWO_CLAUDE_BIN;

    await writeFile(
      fakeClaude,
      [
        "#!/usr/bin/env node",
        'process.stdout.write(JSON.stringify({ type: "result", subtype: "success", result: "" }));',
        ""
      ].join("\n")
    );
    await chmod(fakeClaude, 0o755);
    process.env.SYSTWO_CLAUDE_BIN = fakeClaude;

    try {
      const result = await delegateTask(
        {
          provider: "claude",
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
        delete process.env.SYSTWO_CLAUDE_BIN;
      } else {
        process.env.SYSTWO_CLAUDE_BIN = previousBin;
      }
    }
  });

  it("passes configured Claude Code model flags before the prompt separator", () => {
    const brief: TaskBrief = {
      goal: "Fix the failing concrete unit test.",
      contextSummary: "",
      preset: "fix_failures",
      permissions: ["read", "temp_edit", "command"],
      acceptanceCriteria: ["npm test passes"],
      testCommand: "npm test"
    };
    const resolution = resolveClaudeModelArgs(brief, {
      mode: "hybrid",
      tiers: {
        high: {
          model: "sonnet",
          fallbackModel: "haiku",
          effort: "high"
        }
      }
    });

    expect(resolution.ok).toBe(true);
    if (!resolution.ok) {
      return;
    }
    const args = buildClaudeArgs(brief, "temp_worktree", resolution.args);
    const separatorIndex = args.indexOf("--");

    expect(args.indexOf("--model")).toBeGreaterThan(-1);
    expect(args.indexOf("--model")).toBeLessThan(separatorIndex);
    expect(args).toContain("sonnet");
    expect(args).toContain("--fallback-model");
    expect(args).toContain("haiku");
    expect(args).toContain("--effort");
    expect(args).toContain("high");
  });

  it("fails explicit Claude model policy when effort is invalid", () => {
    const resolution = resolveClaudeModelArgs(
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
          high: { model: "sonnet", effort: "minimal" as never }
        }
      }
    );

    expect(resolution.ok).toBe(false);
    if (resolution.ok) {
      return;
    }
    expect(resolution.summary).toMatch(/effort must be one of low, medium, high, xhigh, max/i);
  });

  it("parses Claude Code json output for result text and usage", () => {
    const parsed = parseClaudeJsonOutput(
      JSON.stringify({
        type: "result",
        subtype: "success",
        result: "final result text",
        total_cost_usd: 0.02,
        usage: {
          input_tokens: 321,
          output_tokens: 54
        },
        permission_denials: ["Bash(grep -qx NEW greeting.txt)"]
      })
    );

    expect(parsed?.resultText).toBe("final result text");
    expect(parsed?.actualUsage).toEqual({
      source: "provider",
      inputTokens: 321,
      outputTokens: 54,
      costUsd: 0.02
    });
    expect(parsed?.permissionDenials).toContain("Bash(grep -qx NEW greeting.txt)");
  });
});
