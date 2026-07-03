import { z } from "zod";

/**
 * Prompt-to-image generation for the canvas workbench (design doc
 * 2026-07-03-infinite-canvas-sidebar.md, S7). The controller drives the
 * OpenClaw `image_generate` agent tool over a dedicated utility subagent
 * lane and returns a URL servable by GET /api/v1/media/state-file.
 */

export const generateImageRequestSchema = z.object({
  prompt: z.string().min(1).max(2_000),
});

export const generateImageResponseSchema = z.object({
  /** Servable URL (relative to the controller origin). */
  url: z.string(),
  /** Absolute path of the generated file inside the OpenClaw media dir. */
  path: z.string(),
});

export type GenerateImageRequest = z.infer<typeof generateImageRequestSchema>;
export type GenerateImageResponse = z.infer<typeof generateImageResponseSchema>;
