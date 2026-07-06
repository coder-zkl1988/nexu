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

export const generateImageRequestSchema = z
  .object({
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
    /**
     * Source image for inpaint / img2img. Servable absolute path under the
     * OpenClaw media dir. When provided the agent edits this image rather
     * than generating from scratch.
     */
    sourceImage: z.string().min(1).optional(),
    /**
     * Mask data URL (data:image/...) marking the editable region. White
     * pixels = editable, black pixels = keep unchanged. Max 8 MB. Requires
     * sourceImage to be present.
     */
    maskDataUrl: z.string().startsWith("data:image/").max(8_000_000).optional(),
  })
  .refine(
    (v) => !(v.maskDataUrl !== undefined && v.sourceImage === undefined),
    { message: "maskDataUrl requires sourceImage", path: ["maskDataUrl"] },
  );

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

/**
 * Enhance-image channel: super-resolve (upscale) or multi-angle (re-render
 * from a different camera angle). UNAVAILABLE-first — ships before backend
 * skills land.
 */
export const enhanceImageRequestSchema = z.object({
  /** Source image to enhance. Absolute path under the OpenClaw media dir. */
  sourceImage: z.string().min(1),
  /** Operation to perform. */
  operation: z.enum(["super-resolve", "multi-angle"]),
  /**
   * For super-resolve: the target long-edge pixel count. Defaults to 2048.
   */
  targetLongEdge: z
    .union([z.literal(1024), z.literal(2048), z.literal(4096)])
    .optional(),
  /** For multi-angle: horizontal (yaw) rotation in degrees. */
  horizontalDeg: z.number().min(-60).max(60).optional(),
  /** For multi-angle: pitch (tilt) rotation in degrees. */
  pitchDeg: z.number().min(-45).max(45).optional(),
  /** For multi-angle: distance factor (1–10). */
  distance: z.number().min(1).max(10).optional(),
  /** For multi-angle: apply wide-angle lens effect. */
  wideAngle: z.boolean().optional(),
  /** Optional extra guidance prompt for either operation. */
  prompt: z.string().max(2_000).optional(),
});

export const enhanceImageResponseSchema = z.object({
  url: z.string(),
  path: z.string(),
  items: z.array(generatedMediaItemSchema).min(1),
});

/**
 * Describe-image channel: reverse-prompt (generate a text-to-image prompt
 * that describes the given image). May work today with vision-capable models.
 */
export const describeImageRequestSchema = z.object({
  /** Source image to describe. Absolute path under the OpenClaw media dir. */
  sourceImage: z.string().min(1),
});

export const describeImageResponseSchema = z.object({
  /** The text-to-image generation prompt that would recreate the image. */
  prompt: z.string(),
});

export type GeneratedMediaItem = z.infer<typeof generatedMediaItemSchema>;
export type GenerateImageRequest = z.infer<typeof generateImageRequestSchema>;
export type GenerateImageResponse = z.infer<typeof generateImageResponseSchema>;
export type GenerateVideoRequest = z.infer<typeof generateVideoRequestSchema>;
export type GenerateVideoResponse = z.infer<typeof generateVideoResponseSchema>;
export type GenerateAudioRequest = z.infer<typeof generateAudioRequestSchema>;
export type GenerateAudioResponse = z.infer<typeof generateAudioResponseSchema>;
export type EnhanceImageRequest = z.infer<typeof enhanceImageRequestSchema>;
export type EnhanceImageResponse = z.infer<typeof enhanceImageResponseSchema>;
export type DescribeImageRequest = z.infer<typeof describeImageRequestSchema>;
export type DescribeImageResponse = z.infer<typeof describeImageResponseSchema>;
