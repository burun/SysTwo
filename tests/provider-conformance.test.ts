import { describe, expect, it } from "vitest";
import { runProviderConformance } from "../src/providers/conformance.js";

describe("provider conformance", () => {
  it("passes the baseline conformance suite for the deterministic mock provider", async () => {
    const checks = await runProviderConformance("mock");

    expect(checks.map((check) => check.name)).toEqual([
      "direct_read returns reviewable output without main worktree changes",
      "patch_only returns a non-empty patch proposal",
      "temp_worktree returns diff and passing test evidence"
    ]);
    expect(checks.every((check) => check.ok)).toBe(true);
  });
});
