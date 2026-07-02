import { createInterface } from "node:readline";
import { loadConfig } from "../config/config.js";
import { delegateTask } from "../core/delegate.js";
import { routeThenDelegateTask } from "../core/route-then-delegate.js";
import { toErrorMessage } from "../core/errors.js";
import { DelegateTaskInputSchema, RouteTaskInputSchema, RouteThenDelegateInputSchema } from "../core/types.js";
import { routeTask } from "../router/router.js";

type JsonRpcRequest = {
  jsonrpc?: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
};

type ToolCallParams = {
  name: string;
  arguments?: unknown;
};

const tools = [
  {
    name: "route_task",
    description: "Return routing advice only. This tool never executes runner work.",
    inputSchema: {
      type: "object",
      properties: {
        goal: { type: "string" },
        contextSummary: { type: "string" },
        repoPath: { type: "string" },
        knownConstraints: { type: "array", items: { type: "string" } },
        desiredOutcome: { enum: ["advice", "patch", "test_fix", "summary"] }
      },
      required: ["goal"]
    }
  },
  {
    name: "delegate_task",
    description: "Delegate bounded execution to a provider with V0 safety constraints.",
    inputSchema: {
      type: "object",
      properties: {
        provider: { type: "string" },
        preset: { enum: ["summarize_codebase", "draft_changes", "fix_failures"] },
        mode: { enum: ["direct_read", "temp_worktree", "patch_only"] },
        brief: { type: "object" },
        repoPath: { type: "string" }
      },
      required: ["brief"]
    }
  },
  {
    name: "route_then_delegate",
    description: "Route a bounded task, then automatically delegate only high-value delegate recommendations.",
    inputSchema: {
      type: "object",
      properties: {
        goal: { type: "string" },
        contextSummary: { type: "string" },
        repoPath: { type: "string" },
        knownConstraints: { type: "array", items: { type: "string" } },
        desiredOutcome: { enum: ["advice", "patch", "test_fix", "summary"] },
        provider: { type: "string" },
        allowedFiles: { type: "array", items: { type: "string" } },
        permissions: { type: "array", items: { enum: ["read", "temp_edit", "command", "network"] } },
        acceptanceCriteria: { type: "array", items: { type: "string" } },
        testCommand: { type: "string" },
        failingLogSummary: { type: "string" },
        riskNotes: { type: "array", items: { type: "string" } }
      },
      required: ["goal"]
    }
  },
  {
    name: "usage_report",
    description: "Report estimated and actual usage support for V0.",
    inputSchema: {
      type: "object",
      properties: {}
    }
  }
];

export function listMcpTools(): typeof tools {
  return tools;
}

export async function startMcpServer(): Promise<void> {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

  rl.on("line", async (line) => {
    if (!line.trim()) {
      return;
    }
    let request: JsonRpcRequest;
    try {
      request = JSON.parse(line) as JsonRpcRequest;
      const result = await handleRequest(request);
      if (request.id !== undefined) {
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\n");
      }
    } catch (error) {
      const id = typeof requestIdFromLine(line) === "undefined" ? null : requestIdFromLine(line);
      process.stdout.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          error: {
            code: -32000,
            message: toErrorMessage(error)
          }
        }) + "\n"
      );
    }
  });
}

async function handleRequest(request: JsonRpcRequest): Promise<unknown> {
  switch (request.method) {
    case "initialize":
      return {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "systwo", version: "0.1.0-rc.0" }
      };
    case "notifications/initialized":
      return {};
    case "tools/list":
      return { tools: listMcpTools() };
    case "tools/call":
      return handleToolCall(request.params as ToolCallParams);
    default:
      throw new Error(`Unsupported MCP method: ${request.method}`);
  }
}

async function handleToolCall(params: ToolCallParams): Promise<unknown> {
  if (params.name === "route_task") {
    const input = RouteTaskInputSchema.parse(params.arguments ?? {});
    const config = loadConfig(input.repoPath ?? process.cwd());
    const result = routeTask(input, config);
    return textResult(result);
  }
  if (params.name === "delegate_task") {
    const args = (params.arguments ?? {}) as Record<string, unknown>;
    const repoPath = typeof args.repoPath === "string" ? args.repoPath : process.cwd();
    const input = DelegateTaskInputSchema.parse(args);
    const result = await delegateTask(input, repoPath);
    return textResult(result);
  }
  if (params.name === "route_then_delegate") {
    const args = (params.arguments ?? {}) as Record<string, unknown>;
    const repoPath = typeof args.repoPath === "string" ? args.repoPath : process.cwd();
    const input = RouteThenDelegateInputSchema.parse(args);
    const result = await routeThenDelegateTask(input, repoPath);
    return textResult(result);
  }
  if (params.name === "usage_report") {
    return textResult({
      estimatedUsage: "supported",
      actualUsage: "recorded when exposed by provider, otherwise marked unavailable",
      finalAnswerHint:
        "When delegate_task returns delegatedUsageSummary, include it in the controller's final response so users can see how much usage was allocated to the runner.",
      telemetry: "disabled by default"
    });
  }
  throw new Error(`Unknown tool: ${params.name}`);
}

function textResult(value: unknown): unknown {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}

function requestIdFromLine(line: string): string | number | null | undefined {
  try {
    return (JSON.parse(line) as JsonRpcRequest).id;
  } catch {
    return undefined;
  }
}
