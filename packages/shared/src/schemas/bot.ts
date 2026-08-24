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
  /**
   * Which model this bot runs on. Null (or absent) means "follow the global
   * default" — the compiler then omits the per-agent model and OpenClaw falls
   * back to agents.defaults.model. Without that state every bot carried a
   * concrete id, so changing the global default could only be made to work by
   * overwriting all of them, which erased any per-bot choice.
   */
  modelId: z.string().nullable().optional(),
  poolId: z.string().optional(),
  expertSlug: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .nullable()
    .optional(),
});

/**
 * Whether runs this bot did not start itself may execute host commands.
 *
 * The desktop user is never gated: `exec`/`process`/`code_execution` stay
 * prompt-free for runs they drive. These two switches only cover the origins
 * the runtime guard refuses by default — inbound channel messages and
 * unattended automation — because both can be driven by someone other than the
 * person at the machine. Both default to "restricted"; opening one is an
 * explicit, per-bot decision.
 */
export const hostExecutionModeSchema = z.enum(["restricted", "host"]);

export const botHostExecutionSchema = z.object({
  channels: hostExecutionModeSchema.default("restricted"),
  automations: hostExecutionModeSchema.default("restricted"),
});

const DEFAULT_HOST_EXECUTION = {
  channels: "restricted",
  automations: "restricted",
} as const;

export const updateBotSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  systemPrompt: z.string().optional(),
  /** Null clears the binding back to "follow the global default". */
  modelId: z.string().nullable().optional(),
  hostExecution: botHostExecutionSchema.partial().optional(),
});

export const botResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  poolId: z.string().nullable(),
  status: botStatusSchema,
  /** Null means this bot follows the global default model. */
  modelId: z.string().nullable().default(null),
  systemPrompt: z.string().nullable(),
  expertSlug: z.string().nullable().default(null),
  origin: botOriginSchema.default("user"),
  // Defaulted so bots persisted before this field existed keep parsing.
  hostExecution: botHostExecutionSchema.default(DEFAULT_HOST_EXECUTION),
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
