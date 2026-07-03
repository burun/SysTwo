import { describe, expect, it } from "vitest";
import { parseProviderManifest, ProviderManifestSchema } from "../src/providers/manifest.js";

describe("provider manifest", () => {
  it("accepts a community CLI provider manifest", () => {
    const manifest = parseProviderManifest({
      id: "aider",
      displayName: "Aider",
      kind: "cli",
      commands: {
        envVar: "SYSTWO_AIDER_BIN",
        candidates: ["aider"]
      },
      capabilities: ["code_search", "draft_patch", "test_retry"],
      modes: {
        direct_read: true,
        patch_only: true,
        temp_worktree: true
      },
      modelPolicy: {
        supportsModel: true,
        supportsFallbackModel: false,
        supportsEffort: false
      },
      output: {
        format: "text",
        usage: "unavailable"
      },
      limitations: ["Sandboxing depends on the provider CLI."]
    });

    expect(manifest.id).toBe("aider");
    expect(manifest.commands.envVar).toBe("SYSTWO_AIDER_BIN");
  });

  it("rejects provider ids that are not lowercase kebab-case", () => {
    const result = ProviderManifestSchema.safeParse({
      id: "Aider Provider",
      displayName: "Aider",
      kind: "cli",
      commands: {
        envVar: "SYSTWO_AIDER_BIN",
        candidates: ["aider"]
      },
      capabilities: ["draft_patch"],
      modes: {
        direct_read: true,
        patch_only: true,
        temp_worktree: true
      },
      modelPolicy: {
        supportsModel: true,
        supportsFallbackModel: false,
        supportsEffort: false
      },
      output: {
        format: "text",
        usage: "unavailable"
      }
    });

    expect(result.success).toBe(false);
  });
});
