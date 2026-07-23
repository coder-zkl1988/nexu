import { z } from "zod";

export const botStatusSchema = z.enum(["active", "paused", "deleted"]);

/**
 * Who owns the bot. "user" bots are created and managed by the user;
 * the single "system" bot is the product-owned desktop assistant — it cannot
 * be deleted or paused and serves as the factory default entry.
 */
export const botOriginSchema = z.enum(["user", "system"]);

export const createBotSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .min(1)
    .max(100),
  systemPrompt: z.string().optional(),
  modelId: z.string().default("gpt-4o"),
  poolId: z.string().optional(),
  expertSlug: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .nullable()
    .optional(),
});

export const updateBotSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  systemPrompt: z.string().optional(),
  modelId: z.string().optional(),
});

export const botResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  poolId: z.string().nullable(),
  status: botStatusSchema,
  modelId: z.string(),
  systemPrompt: z.string().nullable(),
  expertSlug: z.string().nullable().default(null),
  origin: botOriginSchema.default("user"),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const botListResponseSchema = z.object({
  bots: z.array(botResponseSchema),
});

export type BotStatus = z.infer<typeof botStatusSchema>;
export type BotOrigin = z.infer<typeof botOriginSchema>;
export type CreateBotInput = z.infer<typeof createBotSchema>;
export type UpdateBotInput = z.infer<typeof updateBotSchema>;
export type BotResponse = z.infer<typeof botResponseSchema>;
export type BotListResponse = z.infer<typeof botListResponseSchema>;
