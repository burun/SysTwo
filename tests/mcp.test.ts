import { describe, expect, it } from "vitest";
import { listMcpTools } from "../src/mcp/server.js";

describe("MCP surface", () => {
  it("exposes only the V0 tool surface", () => {
    const names = listMcpTools().map((tool) => tool.name);
    expect(names).toEqual(["route_task", "delegate_task", "route_then_delegate", "usage_report"]);
    expect(names).not.toContain("apply_result");
  });
});
