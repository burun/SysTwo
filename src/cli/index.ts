#!/usr/bin/env node
import { Command } from "commander";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runDemo } from "../demo/demo.js";
import { runDoctor } from "../doctor/doctor.js";
import { startMcpServer } from "../mcp/server.js";
import { loadConfig } from "../config/config.js";
import { routeTask } from "../router/router.js";
import { delegateTask } from "../core/delegate.js";
import { routeThenDelegateTask } from "../core/route-then-delegate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf8")) as { version: string };

const program = new Command();

program
  .name("systwo")
  .description("Safe, cost-aware delegation for coding workflows.")
  .version(packageJson.version);

program.command("doctor").description("Check local SysTwo readiness.").action(async () => {
  const checks = await runDoctor(process.cwd());
  for (const check of checks) {
    const mark = check.ok ? "ok" : "fail";
    console.log(`[${mark}] ${check.name}: ${check.message}`);
  }
  if (checks.some((check) => !check.ok && !check.name.startsWith("provider:"))) {
    process.exitCode = 1;
  }
});

program.command("mcp").description("Start the SysTwo MCP stdio server.").action(async () => {
  await startMcpServer();
});

program.command("demo").description("Run the zero-config mock-provider demo.").action(async () => {
  const demo = await runDemo();
  console.log("SysTwo V0 demo");
  console.log(`repo: ${demo.repoPath}`);
  console.log("");
  console.log("route_task advice:");
  console.log(JSON.stringify(demo.route, null, 2));
  console.log("");
  console.log("delegate_task result:");
  console.log(JSON.stringify(demo.result, null, 2));
  console.log("");
  console.log(`main worktree unchanged: ${demo.mainWorktreeUnchanged ? "yes" : "no"}`);
  console.log(`delegated usage: ${demo.result.delegatedUsageSummary ?? "unavailable"}`);
  console.log("final decision: left to controller/human review");
});

program
  .command("run")
  .description("Debug helper: route or delegate a bounded task from JSON.")
  .option("--delegate", "Call delegate_task instead of route_task.")
  .option("--route-then-delegate", "Call route_then_delegate instead of route_task.")
  .requiredOption("--input <json>", "JSON input for the selected operation.")
  .action(async (options: { delegate?: boolean; routeThenDelegate?: boolean; input: string }) => {
    const parsed = JSON.parse(options.input) as unknown;
    if (options.routeThenDelegate) {
      console.log(JSON.stringify(await routeThenDelegateTask(parsed as never, process.cwd()), null, 2));
      return;
    }
    if (options.delegate) {
      console.log(JSON.stringify(await delegateTask(parsed as never, process.cwd()), null, 2));
      return;
    }
    console.log(JSON.stringify(routeTask(parsed as never, loadConfig(process.cwd())), null, 2));
  });

program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
