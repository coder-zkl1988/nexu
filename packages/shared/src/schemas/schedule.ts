import { z } from "zod";

export const createScheduleSchema = z.object({
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
});

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
});

export const scheduleResponseSchema = createScheduleSchema.extend({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  externalId: z.string().optional(),
});

export const scheduleListResponseSchema = z.object({
  schedules: z.array(scheduleResponseSchema),
});

export type CreateScheduleInput = z.infer<typeof createScheduleSchema>;
export type UpdateScheduleInput = z.infer<typeof updateScheduleSchema>;
export type ScheduleResponse = z.infer<typeof scheduleResponseSchema>;
export type ScheduleListResponse = z.infer<typeof scheduleListResponseSchema>;
