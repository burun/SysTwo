import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "../../src/core/shell.js";

export async function createFixtureRepo(): Promise<string> {
  const repoPath = await mkdtemp(join(tmpdir(), "systwo-test-"));
  await runCommand("git", ["init"], { cwd: repoPath });
  await writeFile(
    join(repoPath, "math.js"),
    ["export function add(a, b) {", "  return a - b;", "}", ""].join("\n")
  );
  await writeFile(
    join(repoPath, "test.js"),
    [
      "import { strict as assert } from 'node:assert';",
      "import { add } from './math.js';",
      "assert.equal(add(2, 3), 5);",
      ""
    ].join("\n")
  );
  await writeFile(join(repoPath, "package.json"), JSON.stringify({ type: "module" }, null, 2) + "\n");
  await writeFile(join(repoPath, ".gitignore"), ".systwo/\n");
  await runCommand("git", ["add", "."], { cwd: repoPath });
  await runCommand(
    "git",
    ["-c", "user.name=SysTwo Test", "-c", "user.email=test@systwo.local", "commit", "-m", "fixture"],
    { cwd: repoPath }
  );
  return repoPath;
}
