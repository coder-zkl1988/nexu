import { z } from "zod";

export const mirrorSnapshotFrameSchema = z.object({
  channel: z.literal("mirror"),
  type: z.enum(["snapshot", "realtime"]),
  deviceId: z.string(),
  screenshot: z.string(), // base64 PNG or JPEG
  format: z.enum(["png", "jpeg"]).default("png"),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  screenWidth: z.number().int().positive().optional(),
  screenHeight: z.number().int().positive().optional(),
  streamWidth: z.number().int().positive().optional(),
  streamHeight: z.number().int().positive().optional(),
  timestamp: z.number().int().nonnegative(),
  currentApp: z.string().optional(),
  deviceStatus: z.enum(["idle", "busy", "error"]),
});

/**
 * Schema for the binary frame header in MQTT mirror frames.
 * Format: JSON header (this schema) + '\n' + JPEG/WebP binary bytes.
 * Produced by MqttClientManager.publishFrame() on Android.
 */
export const mirrorFrameHeaderSchema = z.object({
  seq: z.number().int().nonnegative().optional(),
  ts: z.number().int().positive(),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
  app: z.string().optional(),
  status: z.string().default("idle"),
  fmt: z.string().default("jpeg"),
  len: z.number().int().positive().optional(),
});
export type MirrorFrameHeader = z.infer<typeof mirrorFrameHeaderSchema>;

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
  z.object({
    type: z.literal("long_press"),
    x: z.number().int(),
    y: z.number().int(),
    durationMs: z.number().int().optional().default(500),
  }),
  z.object({
    type: z.literal("scroll"),
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    hScroll: z.number().min(-1).max(1),
    vScroll: z.number().min(-1).max(1),
  }),
  z.object({
    type: z.literal("back_or_screen_on"),
  }),
  z.object({
    type: z.literal("touch_raw"),
    action: z.number().int().min(0).max(2),
    pointerId: z.number().int().min(0).max(9),
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    pressure: z.number().int().min(0).max(1000),
    actionButton: z.number().int().nonnegative().default(0),
    buttons: z.number().int().nonnegative().default(0),
  }),
  z.object({
    type: z.literal("set_clipboard"),
    text: z.string(),
    paste: z.boolean().default(false),
    sequence: z.number().int().nonnegative().default(0),
  }),
  z.object({
    type: z.literal("get_clipboard"),
    sequence: z.number().int().nonnegative().default(0),
  }),
]);

export type MirrorSnapshotFrame = z.infer<typeof mirrorSnapshotFrameSchema>;
export type MirrorClientAction = z.infer<typeof mirrorClientActionSchema>;

/** Binary frame type for audio (Opus) — future Android app support */
export const MIRROR_FRAME_TYPE_OPUS = 0x02;
