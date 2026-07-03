import { describe, expect, it } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initProviderScaffold } from "../src/providers/scaffold.js";

describe("provider scaffold", () => {
  it("creates a manifest, adapter template, test template, and README", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "systwo-provider-scaffold-"));
    const result = await initProviderScaffold({ id: "OpenCode", rootDir });

    expect(result.manifest.id).toBe("open-code");
    expect(result.files.map((file) => file.slice(rootDir.length + 1)).sort()).toEqual([
      "open-code/README.md",
      "open-code/manifest.json",
      "open-code/provider.test.ts",
      "open-code/provider.ts"
    ]);

    const manifest = JSON.parse(await readFile(join(rootDir, "open-code", "manifest.json"), "utf8")) as { id: string };
    const provider = await readFile(join(rootDir, "open-code", "provider.ts"), "utf8");

    expect(manifest.id).toBe("open-code");
    expect(provider).toContain('id: "open-code"');
    expect(provider).toContain("createCliProvider");
  });

  it("refuses to overwrite an existing scaffold unless force is set", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "systwo-provider-scaffold-"));
    await initProviderScaffold({ id: "aider", rootDir });

    await expect(initProviderScaffold({ id: "aider", rootDir })).rejects.toThrow(/already exists/i);
    await expect(initProviderScaffold({ id: "aider", rootDir, force: true })).resolves.toMatchObject({
      manifest: { id: "aider" }
    });
  });
});
