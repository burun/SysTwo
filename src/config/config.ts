import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import YAML from "yaml";

export type SysTwoConfig = {
  routing: {
    defaultProvider: string;
  };
  providers: {
    codebuddy: {
      modelPolicy: CodeBuddyModelPolicy;
    };
  };
  permissions: {
    read: true;
    temp_edit: boolean;
    command: boolean | "ask";
    network: boolean;
  };
  worktrees: {
    root: string;
    cleanup: "on_success" | "never";
    maxConcurrent: number;
  };
  usage: {
    estimateBeforeRun: boolean;
    recordActualWhenAvailable: boolean;
  };
};

export type CodeBuddyModelPolicyMode = "auto" | "hybrid" | "manual";
export type CodeBuddyModelTierName = "low" | "medium" | "high";
export type CodeBuddyEffort = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export type CodeBuddyModelTier = {
  model?: string;
  fallbackModel?: string;
  effort?: CodeBuddyEffort;
};

export type CodeBuddyModelPolicy = {
  mode: CodeBuddyModelPolicyMode;
  tiers: Partial<Record<CodeBuddyModelTierName, CodeBuddyModelTier>>;
};

export const defaultConfig: SysTwoConfig = {
  routing: {
    defaultProvider: "mock"
  },
  providers: {
    codebuddy: {
      modelPolicy: {
        mode: "auto",
        tiers: {}
      }
    }
  },
  permissions: {
    read: true,
    temp_edit: false,
    command: false,
    network: false
  },
  worktrees: {
    root: ".systwo/worktrees",
    cleanup: "on_success",
    maxConcurrent: 2
  },
  usage: {
    estimateBeforeRun: true,
    recordActualWhenAvailable: true
  }
};

function readYamlIfPresent(path: string): Partial<SysTwoConfig> {
  if (!existsSync(path)) {
    return {};
  }
  const parsed = YAML.parse(readFileSync(path, "utf8")) as Partial<SysTwoConfig> | undefined;
  return parsed ?? {};
}

function mergeConfig(base: SysTwoConfig, next: Partial<SysTwoConfig>): SysTwoConfig {
  return {
    routing: { ...base.routing, ...next.routing },
    providers: {
      codebuddy: {
        modelPolicy: {
          mode: next.providers?.codebuddy?.modelPolicy?.mode ?? base.providers.codebuddy.modelPolicy.mode,
          tiers: mergeCodeBuddyModelTiers(
            base.providers.codebuddy.modelPolicy.tiers,
            next.providers?.codebuddy?.modelPolicy?.tiers
          )
        }
      }
    },
    permissions: {
      ...base.permissions,
      ...next.permissions,
      read: true,
      network: false
    },
    worktrees: { ...base.worktrees, ...next.worktrees },
    usage: { ...base.usage, ...next.usage }
  };
}

function mergeCodeBuddyModelTiers(
  base: CodeBuddyModelPolicy["tiers"],
  next?: CodeBuddyModelPolicy["tiers"]
): CodeBuddyModelPolicy["tiers"] {
  if (!next) {
    return { ...base };
  }
  return {
    low: { ...base.low, ...next.low },
    medium: { ...base.medium, ...next.medium },
    high: { ...base.high, ...next.high }
  };
}

export function loadConfig(repoPath = process.cwd()): SysTwoConfig {
  const userConfig = readYamlIfPresent(join(homedir(), ".config", "systwo", "config.yaml"));
  const repoConfig = readYamlIfPresent(join(repoPath, "systwo.yaml"));
  return mergeConfig(mergeConfig(defaultConfig, userConfig), repoConfig);
}

export function resolveWorktreeRoot(repoPath: string, config: SysTwoConfig): string {
  return resolve(repoPath, config.worktrees.root);
}
