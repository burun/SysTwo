import { describe, expect, it } from "vitest";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { delegateTask } from "../src/core/delegate.js";
import type { TaskBrief } from "../src/core/types.js";
import { buildCodexArgs, parseCodexJsonOutput, resolveCodexModelArgs } from "../src/providers/codex/provider.js";
import { createFixtureRepo } from "./helpers/repo.js";

describe("Codex provider argument shape", () => {
  it("uses codex exec json mode with bounded non-interactive safety flags", () => {
    const args = buildCodexArgs(
      {
        goal: "Reply with exactly: SYSTWO_CODEX_ARG_SHAPE_OK",
        contextSummary: "",
        permissions: ["read"],
        acceptanceCriteria: ["Return the requested text"]
      },
      "temp_worktree",
      "/tmp/example-repo",
      "/tmp/last-message.txt"
    );

    expect(args.slice(0, 3)).toEqual(["--sandbox", "workspace-write", "-a"]);
    expect(args).toContain("exec");
    expect(args.indexOf("exec")).toBeLessThan(args.indexOf("--json"));
    expect(args).toContain("--output-last-message");
    expect(args).toContain("/tmp/last-message.txt");
    expect(args).toContain("--cd");
    expect(args).toContain("/tmp/example-repo");
    expect(args).toContain("never");
    expect(args).toContain("--ephemeral");
    expect(args.at(-1)).toContain("SYSTWO_CODEX_ARG_SHAPE_OK");
  });

  it("keeps patch_only runs read-only at the Codex sandbox boundary", () => {
    const args = buildCodexArgs(
      {
        goal: "Draft a small reviewable patch.",
        contextSummary: "",
        permissions: ["read"],
        acceptanceCriteria: ["Return a patch proposal"],
        testCommand: "npm test"
      },
      "patch_only",
      "/tmp/example-repo",
      "/tmp/last-message.txt"
    );

    const sandboxIndex = args.indexOf("--sandbox");
    expect(args.at(sandboxIndex + 1)).toBe("read-only");
    expect(args.at(-1)).toContain("Read-only filesystem mode");
    expect(args.at(-1)).toContain("Return a patch proposal");
    expect(args.at(-1)).not.toContain("Test command: npm test");
  });

  it("passes configured Codex model flags before the prompt", () => {
    const brief: TaskBrief = {
      goal: "Fix the failing concrete unit test.",
      contextSummary: "",
      preset: "fix_failures",
      permissions: ["read", "temp_edit", "command"],
      acceptanceCriteria: ["npm test passes"],
      testCommand: "npm test"
    };
    const resolution = resolveCodexModelArgs(brief, {
      mode: "hybrid",
      tiers: {
        high: {
          model: "gpt-5-codex"
        }
      }
    });

    expect(resolution.ok).toBe(true);
    if (!resolution.ok) {
      return;
    }
    const args = buildCodexArgs(brief, "temp_worktree", "/tmp/example-repo", "/tmp/last-message.txt", resolution.args);
    const promptIndex = args.length - 1;

    expect(args.indexOf("--model")).toBeGreaterThan(-1);
    expect(args.indexOf("--model")).toBeLessThan(promptIndex);
    expect(args.indexOf("--model")).toBeLessThan(args.indexOf("exec"));
    expect(args).toContain("gpt-5-codex");
  });

  it("fails explicit Codex model policy when unsupported fallback or effort fields are configured", () => {
    const resolution = resolveCodexModelArgs(
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
          high: { model: "gpt-5-codex", fallbackModel: "gpt-5" } as never
        }
      }
    );

    expect(resolution.ok).toBe(false);
    if (resolution.ok) {
      return;
    }
    expect(resolution.summary).toMatch(/fallbackModel is not supported by codex exec/i);
  });

  it("parses Codex jsonl output for final text and usage", () => {
    const parsed = parseCodexJsonOutput(
      [
        JSON.stringify({ type: "thread.started", thread_id: "thread-1" }),
        JSON.stringify({
          type: "item.completed",
          item: { id: "item-1", type: "agent_message", text: "final result text" }
        }),
        JSON.stringify({
          type: "turn.completed",
          usage: {
            input_tokens: 321,
            output_tokens: 54,
            reasoning_output_tokens: 10
          }
        })
      ].join("\n")
    );

    expect(parsed?.resultText).toBe("final result text");
    expect(parsed?.actualUsage).toEqual({
      source: "provider",
      inputTokens: 321,
      outputTokens: 54,
      totalTokens: 385
    });
  });

  it("fails patch_only delegation when Codex returns no patch proposal", async () => {
    const repoPath = await createFixtureRepo();
    const binDir = await mkdtemp(join(tmpdir(), "systwo-codex-bin-"));
    const fakeCodex = join(binDir, "codex-empty-result.js");
    const previousBin = process.env.SYSTWO_CODEX_BIN;

    await writeFile(
      fakeCodex,
      [
        "#!/usr/bin/env node",
        "process.stdout.write(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 0 } }) + '\\n');",
        ""
      ].join("\n")
    );
    await chmod(fakeCodex, 0o755);
    process.env.SYSTWO_CODEX_BIN = fakeCodex;

    try {
      const result = await delegateTask(
        {
          provider: "codex",
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
        delete process.env.SYSTWO_CODEX_BIN;
      } else {
        process.env.SYSTWO_CODEX_BIN = previousBin;
      }
    }
  });

  it("captures Codex temp_worktree edits as diff and test evidence", async () => {
    const repoPath = await createFixtureRepo();
    const binDir = await mkdtemp(join(tmpdir(), "systwo-codex-bin-"));
    const fakeCodex = join(binDir, "codex-fix-test.js");
    const previousBin = process.env.SYSTWO_CODEX_BIN;

    await writeFile(
      fakeCodex,
      [
        "#!/usr/bin/env node",
        "const { readFileSync, writeFileSync } = require('node:fs');",
        "const { join } = require('node:path');",
        "const args = process.argv.slice(2);",
        "const outputPath = args[args.indexOf('--output-last-message') + 1];",
        "const mathPath = join(process.cwd(), 'math.js');",
        "const current = readFileSync(mathPath, 'utf8');",
        "writeFileSync(mathPath, current.replace('return a - b;', 'return a + b;'));",
        "writeFileSync(outputPath, 'Fixed math.js and ran the requested test.');",
        "process.stdout.write(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Fixed math.js' } }) + '\\n');",
        "process.stdout.write(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5 } }) + '\\n');",
        ""
      ].join("\n")
    );
    await chmod(fakeCodex, 0o755);
    process.env.SYSTWO_CODEX_BIN = fakeCodex;

    try {
      const result = await delegateTask(
        {
          provider: "codex",
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

      expect(result.status).toBe("needs_review");
      expect(result.diffPath).toBeTruthy();
      expect(result.changedFiles).toContain("math.js");
      expect(result.testEvidence?.status).toBe("passed");
      expect(result.usage.actual?.source).toBe("provider");
    } finally {
      if (previousBin === undefined) {
        delete process.env.SYSTWO_CODEX_BIN;
      } else {
        process.env.SYSTWO_CODEX_BIN = previousBin;
      }
    }
  });
});
