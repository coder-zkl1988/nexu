import { z } from "zod";

export const scheduleNotificationStatusSchema = z.enum([
  "delivered",
  "suppressed",
  "failed",
]);

const scheduleNotificationSettingsSchema = z.object({
  /** Suppress the normal delivery when the normalized output is unchanged. */
  onlyNotifyOnChange: z.boolean().default(false),
  /** OpenClaw per-job cron failure alert policy. */
  failureAlertEnabled: z.boolean().default(false),
  failureAlertAfter: z.number().int().min(1).max(100).default(3),
});

export const createScheduleSchema = z
  .object({
    botId: z.string(),
    name: z.string().min(1).max(255),
    cron: z.string(),
    timezone: z.string().default("UTC"),
    prompt: z.string(),
    enabled: z.boolean().default(true),
    source: z.enum(["ui", "agent"]).default("ui"),
    sessionKey: z.string().optional(),
    channelType: z.string().optional(),
    channelId: z.string().optional(),
    description: z.string().optional(),
    /** Per-job model override (OpenClaw cron payload.model). Empty = bot default. */
    modelId: z.string().optional(),
  })
  .extend(scheduleNotificationSettingsSchema.shape);

export const updateScheduleSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  cron: z.string().optional(),
  timezone: z.string().optional(),
  prompt: z.string().optional(),
  enabled: z.boolean().optional(),
  source: z.enum(["ui", "agent"]).optional(),
  sessionKey: z.string().optional(),
  channelType: z.string().optional(),
  channelId: z.string().optional(),
  description: z.string().optional(),
  /** Per-job model override; empty string clears back to the bot default. */
  modelId: z.string().optional(),
  onlyNotifyOnChange: z.boolean().optional(),
  failureAlertEnabled: z.boolean().optional(),
  failureAlertAfter: z.number().int().min(1).max(100).optional(),
});

export const scheduleResponseSchema = createScheduleSchema
  .extend({
    id: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    externalId: z.string().optional(),
    /** Live OpenClaw cron state. These fields are absent while disconnected. */
    nextRunAtMs: z.number().int().optional(),
    lastRunAtMs: z.number().int().optional(),
    lastDurationMs: z.number().int().nonnegative().optional(),
    lastRunStatus: z.enum(["ok", "error", "skipped"]).optional(),
    lastDeliveryStatus: z
      .enum(["delivered", "not-delivered", "unknown", "not-requested"])
      .optional(),
    deliveryMode: z.enum(["none", "announce", "webhook"]).optional(),
    deliveryChannel: z.string().optional(),
    deliveryTo: z.string().optional(),
    deliveryAccountId: z.string().optional(),
    /** Controller-owned audit trail for only-notify-on-change delivery. */
    lastOutputFingerprint: z.string().optional(),
    lastOutputObservedAt: z.string().optional(),
    lastOutputNotificationStatus: scheduleNotificationStatusSchema.optional(),
    lastOutputNotificationError: z.string().optional(),
    /**
     * Last time this schedule's run was refused host command execution.
     *
     * Without this the user finds out from a missing artifact rather than from
     * an error: the runtime guard refuses the tool, the agent reports it could
     * not do the work, and the schedule still looks like it ran.
     */
    lastHostExecutionBlock: z
      .object({
        at: z.string(),
        toolName: z.string(),
        reason: z.string(),
      })
      .optional(),
  })
  .extend(scheduleNotificationSettingsSchema.shape);

export const scheduleListResponseSchema = z.object({
  schedules: z.array(scheduleResponseSchema),
});

export type CreateScheduleInput = z.infer<typeof createScheduleSchema>;
export type UpdateScheduleInput = z.infer<typeof updateScheduleSchema>;
export type ScheduleResponse = z.infer<typeof scheduleResponseSchema>;
export type ScheduleListResponse = z.infer<typeof scheduleListResponseSchema>;
