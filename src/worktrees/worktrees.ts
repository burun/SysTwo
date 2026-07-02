import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { SysTwoConfig } from "../config/config.js";
import { resolveWorktreeRoot } from "../config/config.js";
import { runCommand } from "../core/shell.js";
import { SysTwoError } from "../core/errors.js";
import { diffPathForTrace } from "../traces/traces.js";

export type WorktreeSession = {
  traceId: string;
  repoPath: string;
  worktreePath: string;
};

export async function ensureGitRepository(repoPath: string): Promise<void> {
  const result = await runCommand("git", ["rev-parse", "--show-toplevel"], {
    cwd: repoPath,
    allowFailure: true
  });
  if (result.exitCode !== 0) {
    throw new SysTwoError(`${repoPath} is not a git repository.`, "GIT_REPO_REQUIRED");
  }
}

export async function getGitStatus(repoPath: string): Promise<string> {
  const result = await runCommand("git", ["status", "--short", "--untracked-files=all"], { cwd: repoPath });
  return result.stdout
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .filter((line) => !isSysTwoRuntimeStatusLine(line))
    .join("\n");
}

function isSysTwoRuntimeStatusLine(line: string): boolean {
  return /^\s*(?:[ MADRCU?!]{2})\s+\.systwo(?:\/|$)/.test(line);
}

export async function createTempWorktree(repoPath: string, traceId: string, config: SysTwoConfig): Promise<WorktreeSession> {
  await ensureGitRepository(repoPath);
  const root = resolveWorktreeRoot(repoPath, config);
  await mkdir(root, { recursive: true });
  const worktreePath = join(root, `${traceId}-${basename(resolve(repoPath))}`);
  const result = await runCommand("git", ["worktree", "add", "--detach", worktreePath, "HEAD"], {
    cwd: repoPath,
    allowFailure: true,
    timeoutMs: 30000
  });
  if (result.exitCode !== 0) {
    throw new SysTwoError(`Failed to create temporary worktree: ${result.stderr}`, "WORKTREE_CREATE_FAILED");
  }
  return { traceId, repoPath, worktreePath };
}

export async function removeWorktree(session: WorktreeSession): Promise<void> {
  await runCommand("git", ["worktree", "remove", "--force", session.worktreePath], {
    cwd: session.repoPath,
    allowFailure: true
  });
  await rm(session.worktreePath, { recursive: true, force: true });
}

export async function captureDiff(session: WorktreeSession): Promise<{ diffPath: string; inlinePatch?: string; changedFiles: string[] }> {
  await runCommand("git", ["add", "-N", "--", "."], {
    cwd: session.worktreePath,
    allowFailure: true
  });
  const diff = await runCommand("git", ["diff", "--binary"], { cwd: session.worktreePath });
  const changed = await runCommand("git", ["diff", "--name-only"], { cwd: session.worktreePath });
  const diffPath = diffPathForTrace(session.repoPath, session.traceId);
  await mkdir(dirname(diffPath), { recursive: true });
  await writeFile(diffPath, diff.stdout);
  const inlinePatch = diff.stdout.length > 0 && diff.stdout.length <= 24000 ? diff.stdout : undefined;
  return {
    diffPath,
    inlinePatch,
    changedFiles: changed.stdout.split(/\r?\n/).filter(Boolean)
  };
}

export async function runTestCommand(command: string, cwd: string): Promise<{ status: "passed" | "failed"; exitCode: number; output: string }> {
  const result = await runCommand("sh", ["-c", command], {
    cwd,
    allowFailure: true,
    timeoutMs: 60000
  });
  return {
    status: result.exitCode === 0 ? "passed" : "failed",
    exitCode: result.exitCode,
    output: [result.stdout, result.stderr].filter(Boolean).join("\n").trim()
  };
}
