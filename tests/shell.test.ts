import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { commandExists } from "../src/core/shell.js";

describe("shell helpers", () => {
  it("checks command availability without invoking a shell", async () => {
    const sentinel = join(tmpdir(), `systwo-command-exists-${Date.now()}`);

    const exists = await commandExists(`missing-codebuddy; touch ${sentinel}`);

    expect(exists).toBe(false);
    expect(existsSync(sentinel)).toBe(false);
  });
});
