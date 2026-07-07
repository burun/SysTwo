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
    claude: {
      modelPolicy: ClaudeModelPolicy;
    };
    codex: {
      modelPolicy: CodexModelPolicy;
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
    pricing?: UsagePricing;
  };
};

export type UsagePricing = {
  controllerUsdPerMTok?: number;
  runnerUsdPerMTok?: number;
};

export type ModelPolicyMode = "auto" | "hybrid" | "manual";
export type ModelTierName = "low" | "medium" | "high";
export type ModelEffort = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export type ModelTier = {
  model?: string;
  fallbackModel?: string;
  effort?: ModelEffort;
};

export type ModelPolicy = {
  mode: ModelPolicyMode;
  tiers: Partial<Record<ModelTierName, ModelTier>>;
};

export type CodeBuddyModelPolicyMode = ModelPolicyMode;
export type CodeBuddyModelTierName = ModelTierName;
export type CodeBuddyEffort = ModelEffort;
export type CodeBuddyModelTier = ModelTier;
export type CodeBuddyModelPolicy = ModelPolicy;
export type ClaudeModelPolicyMode = ModelPolicyMode;
export type ClaudeModelTierName = ModelTierName;
export type ClaudeEffort = Exclude<ModelEffort, "minimal">;
export type ClaudeModelTier = Omit<ModelTier, "effort"> & { effort?: ClaudeEffort };
export type ClaudeModelPolicy = {
  mode: ClaudeModelPolicyMode;
  tiers: Partial<Record<ClaudeModelTierName, ClaudeModelTier>>;
};
export type CodexModelPolicyMode = ModelPolicyMode;
export type CodexModelTierName = ModelTierName;
export type CodexModelTier = Pick<ModelTier, "model"> & {
  fallbackModel?: never;
  effort?: never;
};
export type CodexModelPolicy = {
  mode: CodexModelPolicyMode;
  tiers: Partial<Record<CodexModelTierName, CodexModelTier>>;
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
    },
    claude: {
      modelPolicy: {
        mode: "auto",
        tiers: {}
      }
    },
    codex: {
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
          tiers: mergeModelTiers(
            base.providers.codebuddy.modelPolicy.tiers,
            next.providers?.codebuddy?.modelPolicy?.tiers
          )
        }
      },
      claude: {
        modelPolicy: {
          mode: next.providers?.claude?.modelPolicy?.mode ?? base.providers.claude.modelPolicy.mode,
          tiers: mergeModelTiers(base.providers.claude.modelPolicy.tiers, next.providers?.claude?.modelPolicy?.tiers)
        }
      },
      codex: {
        modelPolicy: {
          mode: next.providers?.codex?.modelPolicy?.mode ?? base.providers.codex.modelPolicy.mode,
          tiers: mergeModelTiers(base.providers.codex.modelPolicy.tiers, next.providers?.codex?.modelPolicy?.tiers)
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
    usage: mergeUsage(base.usage, next.usage)
  };
}

function mergeUsage(base: SysTwoConfig["usage"], next?: Partial<SysTwoConfig["usage"]>): SysTwoConfig["usage"] {
  const pricing = { ...base.pricing, ...next?.pricing };
  return {
    ...base,
    ...next,
    pricing: Object.keys(pricing).length > 0 ? pricing : undefined
  };
}

function mergeModelTiers<Tier extends { model?: string; fallbackModel?: string; effort?: string }>(
  base: Partial<Record<ModelTierName, Tier>>,
  next?: Partial<Record<ModelTierName, Tier>>
): Partial<Record<ModelTierName, Tier>> {
  if (!next) {
    return { ...base };
  }
  return {
    low: { ...base.low, ...next.low } as Tier,
    medium: { ...base.medium, ...next.medium } as Tier,
    high: { ...base.high, ...next.high } as Tier
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
