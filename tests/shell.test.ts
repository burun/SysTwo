import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { commandExists, runCommand } from "../src/core/shell.js";

describe("shell helpers", () => {
  it("checks command availability without invoking a shell", async () => {
    const sentinel = join(tmpdir(), `systwo-command-exists-${Date.now()}`);

    const exists = await commandExists(`missing-codebuddy; touch ${sentinel}`);

    expect(exists).toBe(false);
    expect(existsSync(sentinel)).toBe(false);
  });

  it("resolves absolute-path command candidates such as app-bundled CLIs", async () => {
    const binDir = await mkdtemp(join(tmpdir(), "systwo-bundled-bin-"));
    const bundled = join(binDir, "bundled-cli");
    await writeFile(bundled, "#!/bin/sh\nexit 0\n");
    await chmod(bundled, 0o755);

    expect(await commandExists(bundled)).toBe(true);
    expect(await commandExists(join(binDir, "not-there"))).toBe(false);
  });

  it("closes stdin for non-interactive commands", async () => {
    const binDir = await mkdtemp(join(tmpdir(), "systwo-shell-bin-"));
    const stdinReader = join(binDir, "stdin-reader.js");
    await writeFile(
      stdinReader,
      [
        "#!/usr/bin/env node",
        "let input = '';",
        "process.stdin.setEncoding('utf8');",
        "process.stdin.on('data', (chunk) => { input += chunk; });",
        "process.stdin.on('end', () => { process.stdout.write(JSON.stringify({ closed: true, input })); });",
        ""
      ].join("\n")
    );
    await chmod(stdinReader, 0o755);

    const result = await runCommand(stdinReader, [], { timeoutMs: 1000 });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ closed: true, input: "" });
  });
});
