import { describe, expect, it } from "vitest";
import { routeThenDelegateTask } from "../src/core/route-then-delegate.js";
import { createFixtureRepo } from "./helpers/repo.js";

describe("route_then_delegate", () => {
  it("delegates high-value Chinese failing-test requests", async () => {
    const repoPath = await createFixtureRepo();
    const result = await routeThenDelegateTask(
      {
        goal: "修复失败的加法单元测试",
        contextSummary: "math.js 把加法写成了减法，node test.js 失败。",
        repoPath,
        provider: "mock",
        allowedFiles: ["math.js"],
        testCommand: "node test.js"
      },
      repoPath
    );

    expect(result.status).toBe("delegated");
    if (result.status === "delegated") {
      expect(result.route.recommendedPreset).toBe("fix_failures");
      expect(result.result.provider).toBe("mock");
      expect(result.result.status).toBe("success");
      expect(result.result.testEvidence?.status).toBe("passed");
      expect(result.result.changedFiles).toContain("math.js");
    }
  });

  it("does not auto-delegate medium-value draft changes", async () => {
    const repoPath = await createFixtureRepo();
    const result = await routeThenDelegateTask(
      {
        goal: "实现一个小的加法函数修改",
        repoPath,
        provider: "mock"
      },
      repoPath
    );

    expect(result.status).toBe("not_delegated");
    expect(result.route.recommendedPreset).toBe("draft_changes");
    if (result.status === "not_delegated") {
      expect(result.reason).toMatch(/requires high value/i);
    }
  });
});
