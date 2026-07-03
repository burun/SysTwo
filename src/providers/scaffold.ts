import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ProviderCapability } from "../core/types.js";
import { parseProviderManifest, type ProviderManifest } from "./manifest.js";

export type ProviderScaffoldOptions = {
  id: string;
  rootDir?: string;
  force?: boolean;
};

export type ProviderScaffoldResult = {
  providerDir: string;
  files: string[];
  manifest: ProviderManifest;
};

export async function initProviderScaffold(options: ProviderScaffoldOptions): Promise<ProviderScaffoldResult> {
  const rootDir = resolve(options.rootDir ?? process.cwd());
  const manifest = defaultManifest(options.id);
  const providerDir = join(rootDir, manifest.id);

  if (existsSync(providerDir) && !options.force) {
    throw new Error(`Provider scaffold already exists: ${providerDir}. Use --force to overwrite template files.`);
  }

  await mkdir(providerDir, { recursive: true });
  await mkdir(join(providerDir, "fixtures"), { recursive: true });

  const files = [
    await writeTemplate(providerDir, "manifest.json", JSON.stringify(manifest, null, 2) + "\n"),
    await writeTemplate(providerDir, "provider.ts", providerTemplate(manifest)),
    await writeTemplate(providerDir, "provider.test.ts", testTemplate(manifest)),
    await writeTemplate(providerDir, "README.md", readmeTemplate(manifest))
  ];

  return { providerDir, files, manifest };
}

function defaultManifest(id: string): ProviderManifest {
  return parseProviderManifest({
    id: normalizeProviderId(id),
    displayName: titleCase(id),
    kind: "cli",
    commands: {
      envVar: `SYSTWO_${envName(id)}_BIN`,
      candidates: [normalizeProviderId(id)]
    },
    capabilities: ["code_search", "draft_patch", "test_retry", "mechanical_fix"] satisfies ProviderCapability[],
    modes: {
      direct_read: true,
      patch_only: true,
      temp_worktree: true
    },
    modelPolicy: {
      supportsModel: true,
      supportsFallbackModel: false,
      supportsEffort: false
    },
    output: {
      format: "text",
      usage: "unavailable"
    },
    limitations: ["Replace this with provider-specific sandboxing, network, and telemetry limitations."]
  });
}

async function writeTemplate(providerDir: string, relativePath: string, contents: string): Promise<string> {
  const path = join(providerDir, relativePath);
  await writeFile(path, contents);
  return path;
}

function providerTemplate(manifest: ProviderManifest): string {
  return `import type { RunOptions, TaskBrief } from "systwo/core/types";
import {
  buildBoundedPrompt,
  createCliProvider,
  resolveCliModelArgs,
  type CliModelArgsResolution,
  type ParsedCliOutput
} from "systwo/providers/cli/adapter";

type ${pascalCase(manifest.id)}ModelPolicy = {
  mode: "auto" | "hybrid" | "manual";
  tiers: Partial<Record<"low" | "medium" | "high", { model?: string }>>;
};

export const ${camelCase(manifest.id)}Provider = createCliProvider<${pascalCase(manifest.id)}ModelPolicy>({
  id: "${manifest.id}",
  displayName: "${manifest.displayName}",
  capabilities: ${JSON.stringify(manifest.capabilities)},
  command: {
    envVar: "${manifest.commands.envVar}",
    candidates: ${JSON.stringify(manifest.commands.candidates)}
  },
  estimateBasis: "Heuristic estimate; ${manifest.displayName} actual usage is unavailable until this adapter parses it.",
  doctorMessage(command) {
    return \`${manifest.displayName} CLI was found as "\${command}".\`;
  },
  doctorMissingMessage: "${manifest.displayName} CLI was not found; mock provider remains available.",
  missingSummary: "${manifest.displayName} CLI was not found on PATH.",
  missingRiskNotes: ["Install ${manifest.displayName} or use provider=mock for the zero-config demo."],
  timeoutEnv: "SYSTWO_${envName(manifest.id)}_TIMEOUT_MS",
  defaultTimeoutMs: 120000,
  getModelPolicy() {
    return undefined;
  },
  resolveModelArgs,
  buildArgs(input, mode, _context, modelArgs) {
    return build${pascalCase(manifest.id)}Args(input, mode, modelArgs);
  },
  parseOutput(stdout) {
    return parse${pascalCase(manifest.id)}Output(stdout);
  },
  riskNotes(modelResolution) {
    return [
      modelResolution.riskNote,
      "${manifest.displayName} provider is community-maintained until its safety contract is documented.",
      "Provider output is treated as data and does not trigger follow-up SysTwo actions."
    ];
  }
});

export function resolveModelArgs(
  input: TaskBrief,
  modelPolicy: ${pascalCase(manifest.id)}ModelPolicy | undefined
): CliModelArgsResolution {
  return resolveCliModelArgs(input, modelPolicy, {
    providerName: "${manifest.displayName}",
    configGuidance: "Check this provider's README and supported CLI model list.",
    supportsFallbackModel: ${String(manifest.modelPolicy.supportsFallbackModel)},
    supportsEffort: ${String(manifest.modelPolicy.supportsEffort)},
    supportedEfforts: ${JSON.stringify(manifest.modelPolicy.supportedEfforts ?? [])},
    unsupportedFlagTarget: "${manifest.id}"
  });
}

export function build${pascalCase(manifest.id)}Args(
  input: TaskBrief,
  mode: RunOptions["mode"] = "temp_worktree",
  modelArgs: string[] = []
): string[] {
  return [
    ...modelArgs,
    buildBoundedPrompt(
      input,
      mode,
      "${manifest.displayName}",
      "- Do not create, invoke, or delegate to nested agents or background tasks."
    )
  ];
}

export function parse${pascalCase(manifest.id)}Output(stdout: string): ParsedCliOutput | undefined {
  const resultText = stdout.trim();
  return resultText ? { resultText, permissionDenials: [] } : { permissionDenials: [] };
}
`;
}

function testTemplate(manifest: ProviderManifest): string {
  return `import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseProviderManifest } from "systwo/providers/manifest";

describe("${manifest.id} provider manifest", () => {
  it("matches the SysTwo provider manifest contract", () => {
    const manifest = JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url), "utf8")) as unknown;
    expect(parseProviderManifest(manifest).id).toBe("${manifest.id}");
  });
});
`;
}

function readmeTemplate(manifest: ProviderManifest): string {
  return `# ${manifest.displayName} SysTwo Provider

This scaffold is a starting point for a SysTwo runner adapter.

## Checklist

- Fill in the real CLI argument builder.
- Parse provider output into final text, usage, and permission denials when available.
- Document sandboxing, network, and telemetry limitations.
- Run SysTwo provider conformance before publishing.

\`\`\`bash
systwo provider conformance --provider ${manifest.id}
\`\`\`
`;
}

function normalizeProviderId(id: string): string {
  return id
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function envName(id: string): string {
  return normalizeProviderId(id).replace(/-/g, "_").toUpperCase();
}

function titleCase(id: string): string {
  return normalizeProviderId(id)
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function pascalCase(id: string): string {
  return normalizeProviderId(id)
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function camelCase(id: string): string {
  const pascal = pascalCase(id);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}
