import { z } from "zod";

export const mirrorSnapshotFrameSchema = z.object({
  channel: z.literal("mirror"),
  type: z.enum(["snapshot", "realtime"]),
  deviceId: z.string(),
  screenshot: z.string(), // base64 PNG
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  timestamp: z.number().int().nonnegative(),
  currentApp: z.string().optional(),
  deviceStatus: z.enum(["idle", "busy", "error"]),
});

export const mirrorClientActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("click"),
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("swipe"),
    startX: z.number().int().nonnegative(),
    startY: z.number().int().nonnegative(),
    endX: z.number().int().nonnegative(),
    endY: z.number().int().nonnegative(),
    durationMs: z.number().int().positive().optional(),
  }),
  z.object({
    type: z.literal("input_text"),
    text: z.string(),
  }),
  z.object({
    type: z.literal("press_key"),
    key: z.string(),
  }),
]);

export type MirrorSnapshotFrame = z.infer<typeof mirrorSnapshotFrameSchema>;
export type MirrorClientAction = z.infer<typeof mirrorClientActionSchema>;
