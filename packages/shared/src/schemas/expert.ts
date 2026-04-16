import { z } from "zod";

export const expertManifestSchema = z.object({
  schemaVersion: z.literal(1),
  slug: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .min(1)
    .max(64),
  name: z.string().min(1).max(80),
  emoji: z.string().min(1).max(8),
  category: z.string().min(1).max(32),
  description: z.string().min(1).max(280),
  tags: z.array(z.string().min(1).max(32)).max(10).default([]),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  author: z.string().max(80).default(""),
  systemPrompt: z.string().min(1).max(32_000),
  modelId: z.string().min(1).default("gpt-4o"),
  requiredSkills: z.array(z.string().regex(/^[a-z0-9-]+$/)).default([]),
  workspaceFiles: z.record(z.string(), z.string()).default({}),
});

export const minimalExpertSchema = expertManifestSchema.pick({
  slug: true,
  name: true,
  emoji: true,
  category: true,
  description: true,
  tags: true,
  version: true,
  author: true,
});

export const installedExpertSchema = z.object({
  slug: z.string(),
  version: z.string(),
  botId: z.string(),
  installedAt: z.string(),
});

export const experthubCatalogResponseSchema = z.object({
  experts: z.array(minimalExpertSchema),
  installedSlugs: z.array(z.string()),
  installedExperts: z.array(installedExpertSchema),
  meta: z
    .object({
      version: z.string(),
      updatedAt: z.string(),
      count: z.number(),
    })
    .nullable(),
});

export const installExpertRequestSchema = z.object({ slug: z.string() });
export const installExpertResponseSchema = z.object({
  ok: z.literal(true),
  botId: z.string(),
  slug: z.string(),
});
export const uninstallExpertRequestSchema = z.object({ slug: z.string() });
export const uninstallExpertResponseSchema = z.object({ ok: z.literal(true) });

export type ExpertManifest = z.infer<typeof expertManifestSchema>;
export type MinimalExpert = z.infer<typeof minimalExpertSchema>;
export type InstalledExpert = z.infer<typeof installedExpertSchema>;
export type ExperthubCatalogResponse = z.infer<
  typeof experthubCatalogResponseSchema
>;
export type InstallExpertRequest = z.infer<typeof installExpertRequestSchema>;
export type InstallExpertResponse = z.infer<typeof installExpertResponseSchema>;
export type UninstallExpertRequest = z.infer<
  typeof uninstallExpertRequestSchema
>;
export type UninstallExpertResponse = z.infer<
  typeof uninstallExpertResponseSchema
>;
