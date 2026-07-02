import { describe, expect, it } from "vitest";
import { runDemo } from "../src/demo/demo.js";

describe("zero-config demo", () => {
  it("runs route and delegate with the mock provider", async () => {
    const demo = await runDemo();
    expect(demo.route.requiresExplicitControllerCall).toBe(true);
    expect(demo.result.provider).toBe("mock");
    expect(demo.result.diffPath).toBeTruthy();
    expect(demo.result.testEvidence?.status).toBe("passed");
    expect(demo.mainWorktreeUnchanged).toBe(true);
  });
});
