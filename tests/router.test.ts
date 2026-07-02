import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/config.js";
import { routeTask } from "../src/router/router.js";

describe("route_task", () => {
  it("recommends direct handling for read-only summaries", () => {
    const route = routeTask(
      {
        goal: "Summarize the rendering code",
        desiredOutcome: "summary"
      },
      loadConfig(process.cwd())
    );

    expect(route.recommendedMode).toBe("answer_directly");
    expect(route.recommendedExecutionMode).toBe("answer_directly");
    expect(route.delegationValue).toBe("low");
    expect(route.friction).toBe("none");
    expect(route.permissions).toEqual(["read"]);
    expect(route.rationale).toMatch(/handled directly/i);
  });

  it("recommends patch_only for bounded draft changes", () => {
    const route = routeTask(
      {
        goal: "Draft a small renderer change",
        desiredOutcome: "patch"
      },
      loadConfig(process.cwd())
    );

    expect(route.recommendedMode).toBe("delegate");
    expect(route.recommendedPreset).toBe("draft_changes");
    expect(route.recommendedExecutionMode).toBe("patch_only");
    expect(route.delegationValue).toBe("medium");
    expect(route.friction).toBe("patch_only");
    expect(route.permissions).toEqual(["read"]);
  });

  it("returns advice for a test fix without executing providers", () => {
    const route = routeTask(
      {
        goal: "Fix the failing unit test",
        desiredOutcome: "test_fix"
      },
      loadConfig(process.cwd())
    );

    expect(route.recommendedMode).toBe("delegate");
    expect(route.recommendedPreset).toBe("fix_failures");
    expect(route.recommendedExecutionMode).toBe("temp_worktree");
    expect(route.delegationValue).toBe("high");
    expect(route.friction).toBe("worktree");
    expect(route.requiresExplicitControllerCall).toBe(true);
  });

  it("recognizes Chinese failing-test language", () => {
    const route = routeTask(
      {
        goal: "修复失败的单元测试",
        contextSummary: "node test.js 报错"
      },
      loadConfig(process.cwd())
    );

    expect(route.recommendedMode).toBe("delegate");
    expect(route.recommendedPreset).toBe("fix_failures");
    expect(route.recommendedExecutionMode).toBe("temp_worktree");
    expect(route.delegationValue).toBe("high");
  });

  it("recognizes Chinese implementation language as draft changes", () => {
    const route = routeTask(
      {
        goal: "实现一个小的渲染器修改"
      },
      loadConfig(process.cwd())
    );

    expect(route.recommendedMode).toBe("delegate");
    expect(route.recommendedPreset).toBe("draft_changes");
    expect(route.recommendedExecutionMode).toBe("patch_only");
  });

  it("declines unsafe release operations", () => {
    const route = routeTask(
      {
        goal: "Commit, tag, and push a release",
        desiredOutcome: "patch"
      },
      loadConfig(process.cwd())
    );

    expect(route.recommendedMode).toBe("decline");
    expect(route.risk).toBe("high");
  });
});
