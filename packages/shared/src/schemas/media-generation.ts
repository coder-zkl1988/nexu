import { z } from "zod";

/**
 * Prompt-to-image generation for the canvas workbench (design doc
 * 2026-07-03-infinite-canvas-sidebar.md, S7). The controller drives the
 * OpenClaw `image_generate` agent tool over a dedicated utility subagent
 * lane and returns a URL servable by GET /api/v1/media/state-file.
 *
 * W2.5-2.6: extended with reference images, multi-count, video and audio
 * channels (UNAVAILABLE-first — channels ship before backend skills land).
 */

export const generatedMediaItemSchema = z.object({
  /** Servable URL (relative to the controller origin). */
  url: z.string(),
  /** Absolute path of the generated file inside the OpenClaw media dir. */
  path: z.string(),
});

export const generateImageRequestSchema = z.object({
  prompt: z.string().min(1).max(2_000),
  /**
   * Optional reference images to guide generation. Paths must resolve under
   * the OpenClaw media dir. Up to 4 references. If the active backend does
   * not support references the block is silently ignored by the agent.
   */
  referenceImages: z.array(z.string().min(1)).max(4).optional(),
  /**
   * Number of images to generate. Defaults to 1. Up to 4.
   */
  count: z.number().int().min(1).max(4).optional(),
});

export const generateImageResponseSchema = z.object({
  /** Servable URL of the first generated file (back-compat with S7). */
  url: z.string(),
  /** Absolute path of the first generated file (back-compat with S7). */
  path: z.string(),
  /** All generated items (≥1). url/path duplicate items[0]. */
  items: z.array(generatedMediaItemSchema).min(1),
});

export const generateVideoRequestSchema = z.object({
  prompt: z.string().min(1).max(2_000),
  /** Optional clip duration in seconds (1–60). Passed as a hint to the backend. */
  durationSeconds: z.number().int().min(1).max(60).optional(),
  /** Optional output resolution hint. */
  resolution: z.enum(["720p", "1080p"]).optional(),
});

export const generateVideoResponseSchema = z.object({
  url: z.string(),
  path: z.string(),
  items: z.array(generatedMediaItemSchema).min(1),
});

export const generateAudioRequestSchema = z.object({
  prompt: z.string().min(1).max(2_000),
  /** Optional voice identifier passed as a hint to the TTS backend. */
  voice: z.string().max(100).optional(),
  /** Optional playback speed multiplier (0.5–2). */
  speed: z.number().min(0.5).max(2).optional(),
});

export const generateAudioResponseSchema = z.object({
  url: z.string(),
  path: z.string(),
  items: z.array(generatedMediaItemSchema).min(1),
});

export type GeneratedMediaItem = z.infer<typeof generatedMediaItemSchema>;
export type GenerateImageRequest = z.infer<typeof generateImageRequestSchema>;
export type GenerateImageResponse = z.infer<typeof generateImageResponseSchema>;
export type GenerateVideoRequest = z.infer<typeof generateVideoRequestSchema>;
export type GenerateVideoResponse = z.infer<typeof generateVideoResponseSchema>;
export type GenerateAudioRequest = z.infer<typeof generateAudioRequestSchema>;
export type GenerateAudioResponse = z.infer<typeof generateAudioResponseSchema>;
