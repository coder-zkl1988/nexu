import { z } from "zod";
import { taskResultSchema } from "./device-control.js";

export const deviceTaskHistoryEntrySchema = z.object({
  deviceId: z.string(),
  deviceName: z.string().optional(),
  taskId: z.string(),
  task: z.string(),
  maxSteps: z.number().int().optional(),
  dispatchedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  result: taskResultSchema,
});

export const deviceTaskHistoryIndexSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  entries: z.array(deviceTaskHistoryEntrySchema).default([]),
});

export const deviceTaskHistoryListResponseSchema = z.object({
  entries: z.array(deviceTaskHistoryEntrySchema),
});

export type DeviceTaskHistoryEntry = z.infer<
  typeof deviceTaskHistoryEntrySchema
>;
export type DeviceTaskHistoryIndex = z.infer<
  typeof deviceTaskHistoryIndexSchema
>;
export type DeviceTaskHistoryListResponse = z.infer<
  typeof deviceTaskHistoryListResponseSchema
>;
