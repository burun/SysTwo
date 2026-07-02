import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { defaultConfig, loadConfig } from "../src/config/config.js";

describe("configuration", () => {
  it("defaults CodeBuddy model policy to auto", () => {
    expect(defaultConfig.providers.codebuddy.modelPolicy).toEqual({
      mode: "auto",
      tiers: {}
    });
  });

  it("loads project CodeBuddy model policy tiers from systwo.yaml", async () => {
    const repo = await mkdtemp(join(tmpdir(), "systwo-config-"));
    await mkdir(join(repo, ".git"));
    await writeFile(
      join(repo, "systwo.yaml"),
      [
        "providers:",
        "  codebuddy:",
        "    modelPolicy:",
        "      mode: hybrid",
        "      tiers:",
        "        low:",
        "          model: deepseek-v4-flash",
        "          effort: low",
        "        high:",
        "          model: deepseek-v4-pro",
        "          fallbackModel: glm-5.0-turbo",
        "          effort: high"
      ].join("\n")
    );

    const config = loadConfig(repo);

    expect(config.providers.codebuddy.modelPolicy.mode).toBe("hybrid");
    expect(config.providers.codebuddy.modelPolicy.tiers.low).toEqual({
      model: "deepseek-v4-flash",
      effort: "low"
    });
    expect(config.providers.codebuddy.modelPolicy.tiers.high).toEqual({
      model: "deepseek-v4-pro",
      fallbackModel: "glm-5.0-turbo",
      effort: "high"
    });
  });
});
