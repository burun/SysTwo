import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { constants } from "node:fs";

export type CommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export async function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number; allowFailure?: boolean; stdin?: string } = {}
): Promise<CommandResult> {
  try {
    const result = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      const child = execFile(command, args, {
        cwd: options.cwd,
        timeout: options.timeoutMs ?? 30000,
        maxBuffer: 10 * 1024 * 1024
      }, (error, stdout, stderr) => {
        if (error) {
          reject(Object.assign(error, { stdout, stderr }));
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      });
      child.stdin?.end(options.stdin ?? "");
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error: unknown) {
    const nodeError = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: number | string;
    };
    const exitCode = typeof nodeError.code === "number" ? nodeError.code : 1;
    if (options.allowFailure) {
      return {
        stdout: String(nodeError.stdout ?? ""),
        stderr: String(nodeError.stderr ?? nodeError.message),
        exitCode
      };
    }
    throw error;
  }
}

export async function commandExists(command: string): Promise<boolean> {
  const trimmed = command.trim();
  if (!trimmed) {
    return false;
  }

  if (trimmed.includes("/") || trimmed.includes("\\")) {
    return canExecute(trimmed);
  }

  const pathEntries = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const entry of pathEntries) {
    if (await canExecute(join(entry, trimmed))) {
      return true;
    }
  }
  return false;
}

async function canExecute(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
