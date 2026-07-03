import { z } from "zod";

const ProviderIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/, "provider id must use lowercase kebab-case");

const ProviderCapabilitySchema = z.enum(["code_search", "log_summary", "draft_patch", "test_retry", "mechanical_fix"]);

export const ProviderManifestSchema = z.object({
  id: ProviderIdSchema,
  displayName: z.string().min(1),
  kind: z.enum(["cli"]),
  commands: z.object({
    envVar: z.string().regex(/^SYSTWO_[A-Z0-9_]+_BIN$/),
    candidates: z.array(z.string().min(1)).min(1)
  }),
  capabilities: z.array(ProviderCapabilitySchema).min(1),
  modes: z.object({
    direct_read: z.boolean(),
    patch_only: z.boolean(),
    temp_worktree: z.boolean()
  }),
  modelPolicy: z.object({
    supportsModel: z.boolean(),
    supportsFallbackModel: z.boolean(),
    supportsEffort: z.boolean(),
    supportedEfforts: z.array(z.string().min(1)).optional()
  }),
  output: z.object({
    format: z.enum(["json", "jsonl", "text"]),
    usage: z.enum(["provider", "runner_log", "unavailable"])
  }),
  limitations: z.array(z.string().min(1)).default([])
});

export type ProviderManifest = z.infer<typeof ProviderManifestSchema>;

export function parseProviderManifest(input: unknown): ProviderManifest {
  return ProviderManifestSchema.parse(input);
}
