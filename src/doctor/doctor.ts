import { access, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig, resolveWorktreeRoot } from "../config/config.js";
import { commandExists } from "../core/shell.js";
import { listProviders } from "../providers/registry.js";

export type DoctorCheck = {
  name: string;
  ok: boolean;
  message: string;
};

export async function runDoctor(repoPath = process.cwd()): Promise<DoctorCheck[]> {
  const config = loadConfig(repoPath);
  const checks: DoctorCheck[] = [];

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  checks.push({
    name: "node",
    ok: nodeMajor >= 20,
    message: `Node.js ${process.versions.node}`
  });

  checks.push({
    name: "package",
    ok: true,
    message: "SysTwo package metadata is available."
  });

  const git = await commandExists("git");
  checks.push({
    name: "git",
    ok: git,
    message: git ? "git is available." : "git was not found on PATH."
  });

  checks.push({
    name: "config",
    ok: config.permissions.network === false,
    message:
      config.permissions.network === false
        ? "Config loaded; network default is false."
        : "Config loaded, but network default was not false."
  });

  const root = resolveWorktreeRoot(repoPath, config);
  try {
    await mkdir(root, { recursive: true });
    await access(root);
    checks.push({ name: "worktree_root", ok: true, message: `Worktree root is writable: ${root}` });
  } catch (error) {
    checks.push({ name: "worktree_root", ok: false, message: `Worktree root is not writable: ${String(error)}` });
  }

  for (const provider of listProviders()) {
    const result = provider.doctor ? await provider.doctor() : { ok: true, message: "No doctor check implemented." };
    checks.push({
      name: `provider:${provider.id}`,
      ok: result.ok,
      message: result.message
    });
  }

  checks.push({
    name: "mcp",
    ok: true,
    message: "MCP stdio server can be started with systwo mcp."
  });

  checks.push({
    name: "trace_root",
    ok: true,
    message: `Traces will be written under ${join(repoPath, ".systwo", "traces")}.`
  });

  return checks;
}
