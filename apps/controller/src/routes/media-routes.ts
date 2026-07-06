import { readFile } from "node:fs/promises";
import path from "node:path";
import { type OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  describeImageRequestSchema,
  describeImageResponseSchema,
  enhanceImageRequestSchema,
  enhanceImageResponseSchema,
  generateAudioRequestSchema,
  generateAudioResponseSchema,
  generateImageRequestSchema,
  generateImageResponseSchema,
  generateVideoRequestSchema,
  generateVideoResponseSchema,
} from "@nexu/shared";
import type { ControllerContainer } from "../app/container.js";
import { mediaCacheDir, mediaCachePathFor } from "../lib/media-cache.js";
import {
  ImageGenerationFailedError,
  InvalidMediaReferenceError,
} from "../services/media-generation-service.js";
import type { ControllerBindings } from "../types.js";

const MEDIA_EXTENSION_MIME: Record<string, string> = {
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
};

export function registerMediaRoutes(
  app: OpenAPIHono<ControllerBindings>,
  container: ControllerContainer,
): void {
  // POST /api/v1/media/generate-image — prompt-to-image for the canvas
  // workbench (S7). Drives the OpenClaw image_generate agent tool over a
  // utility subagent lane; the result is served by /media/state-file below.
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/media/generate-image",
      tags: ["Media"],
      request: {
        body: {
          content: {
            "application/json": { schema: generateImageRequestSchema },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: generateImageResponseSchema },
          },
          description: "Image generated and servable via /media/state-file",
        },
        400: {
          content: {
            "application/json": { schema: z.object({ message: z.string() }) },
          },
          description: "Invalid reference image path",
        },
        502: {
          content: {
            "application/json": { schema: z.object({ message: z.string() }) },
          },
          description: "Generation failed or timed out",
        },
      },
    }),
    async (c) => {
      const input = c.req.valid("json");
      try {
        const result = await container.mediaGenerationService.generateImage({
          prompt: input.prompt,
          referenceImages: input.referenceImages,
          count: input.count,
          sourceImage: input.sourceImage,
          maskDataUrl: input.maskDataUrl,
        });
        return c.json(result, 200);
      } catch (error) {
        if (error instanceof InvalidMediaReferenceError) {
          return c.json({ message: error.message }, 400);
        }
        if (error instanceof ImageGenerationFailedError) {
          return c.json({ message: error.message }, 502);
        }
        throw error;
      }
    },
  );

  // POST /api/v1/media/generate-video — UNAVAILABLE-first video generation.
  // Ships before a video backend skill lands; when an official skill lands
  // it lights up with zero code change (same contract pattern as image).
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/media/generate-video",
      tags: ["Media"],
      request: {
        body: {
          content: {
            "application/json": { schema: generateVideoRequestSchema },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: generateVideoResponseSchema },
          },
          description: "Video generated and servable via /media/state-file",
        },
        502: {
          content: {
            "application/json": { schema: z.object({ message: z.string() }) },
          },
          description: "Generation failed or timed out (including UNAVAILABLE)",
        },
      },
    }),
    async (c) => {
      const input = c.req.valid("json");
      try {
        const result = await container.mediaGenerationService.generateVideo({
          prompt: input.prompt,
          durationSeconds: input.durationSeconds,
          resolution: input.resolution,
        });
        return c.json(result, 200);
      } catch (error) {
        if (error instanceof ImageGenerationFailedError) {
          return c.json({ message: error.message }, 502);
        }
        throw error;
      }
    },
  );

  // POST /api/v1/media/generate-audio — UNAVAILABLE-first audio/TTS generation.
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/media/generate-audio",
      tags: ["Media"],
      request: {
        body: {
          content: {
            "application/json": { schema: generateAudioRequestSchema },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: generateAudioResponseSchema },
          },
          description: "Audio generated and servable via /media/state-file",
        },
        502: {
          content: {
            "application/json": { schema: z.object({ message: z.string() }) },
          },
          description: "Generation failed or timed out (including UNAVAILABLE)",
        },
      },
    }),
    async (c) => {
      const input = c.req.valid("json");
      try {
        const result = await container.mediaGenerationService.generateAudio({
          prompt: input.prompt,
          voice: input.voice,
          speed: input.speed,
        });
        return c.json(result, 200);
      } catch (error) {
        if (error instanceof ImageGenerationFailedError) {
          return c.json({ message: error.message }, 502);
        }
        throw error;
      }
    },
  );

  // POST /api/v1/media/enhance-image — UNAVAILABLE-first image enhancement
  // (super-resolve / multi-angle). Ships before backend skills land.
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/media/enhance-image",
      tags: ["Media"],
      request: {
        body: {
          content: {
            "application/json": { schema: enhanceImageRequestSchema },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: enhanceImageResponseSchema },
          },
          description: "Image enhanced and servable via /media/state-file",
        },
        400: {
          content: {
            "application/json": { schema: z.object({ message: z.string() }) },
          },
          description: "Invalid source image path",
        },
        502: {
          content: {
            "application/json": { schema: z.object({ message: z.string() }) },
          },
          description:
            "Enhancement failed or timed out (including UNAVAILABLE)",
        },
      },
    }),
    async (c) => {
      const input = c.req.valid("json");
      try {
        const result =
          await container.mediaGenerationService.enhanceImage(input);
        return c.json(result, 200);
      } catch (error) {
        if (error instanceof InvalidMediaReferenceError) {
          return c.json({ message: error.message }, 400);
        }
        if (error instanceof ImageGenerationFailedError) {
          return c.json({ message: error.message }, 502);
        }
        throw error;
      }
    },
  );

  // POST /api/v1/media/describe-image — UNAVAILABLE-first reverse-prompt
  // (generate a text-to-image prompt from an existing image). May work today
  // with vision-capable models.
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/media/describe-image",
      tags: ["Media"],
      request: {
        body: {
          content: {
            "application/json": { schema: describeImageRequestSchema },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: describeImageResponseSchema },
          },
          description: "Image described — returns a text-to-image prompt",
        },
        400: {
          content: {
            "application/json": { schema: z.object({ message: z.string() }) },
          },
          description: "Invalid source image path",
        },
        502: {
          content: {
            "application/json": { schema: z.object({ message: z.string() }) },
          },
          description:
            "Description failed or timed out (including UNAVAILABLE)",
        },
      },
    }),
    async (c) => {
      const input = c.req.valid("json");
      try {
        const result =
          await container.mediaGenerationService.describeImage(input);
        return c.json(result, 200);
      } catch (error) {
        if (error instanceof InvalidMediaReferenceError) {
          return c.json({ message: error.message }, 400);
        }
        if (error instanceof ImageGenerationFailedError) {
          return c.json({ message: error.message }, 502);
        }
        throw error;
      }
    },
  );

  // Serves media files referenced by chat transcripts (user uploads under
  // media/inbound, generated images under media/tool-image-generation, …).
  // Plain app.get like the screenshots route below: the response is binary
  // consumed by <img> tags, not the generated SDK.
  app.get("/api/v1/media/state-file", async (c) => {
    const rawPath = c.req.query("path");
    if (!rawPath) {
      return c.text("Not found", 404);
    }
    // Only files inside the OpenClaw state media directory are reachable.
    const mediaRoot = path.resolve(container.env.openclawStateDir, "media");
    const resolved = path.resolve(rawPath);
    const relative = path.relative(mediaRoot, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      return c.text("Not found", 404);
    }
    const mime =
      MEDIA_EXTENSION_MIME[path.extname(resolved).toLowerCase()] ??
      "application/octet-stream";
    const serve = (data: Buffer<ArrayBuffer>) =>
      c.body(data, 200, {
        "Content-Type": mime,
        "Cache-Control": "private, max-age=3600",
      });
    try {
      return serve(await readFile(resolved));
    } catch {
      // Original was TTL-cleaned by OpenClaw — fall back to the durable
      // mirror captured at history-read time (see sessions-runtime).
      try {
        return serve(
          await readFile(
            mediaCachePathFor(
              mediaCacheDir(container.env.nexuHomeDir),
              resolved,
            ),
          ),
        );
      } catch {
        return c.text("Not found", 404);
      }
    }
  });

  app.get("/api/v1/media/screenshots/:filename", async (c) => {
    const filename = c.req.param("filename");
    if (!filename || filename.includes("..")) {
      return c.text("Not found", 404);
    }
    const filePath = path.join(container.env.screenshotsDir, filename);
    try {
      const data = await readFile(filePath);
      const ext = path.extname(filename).toLowerCase();
      const mime =
        ext === ".webp"
          ? "image/webp"
          : ext === ".png"
            ? "image/png"
            : "image/jpeg";
      return c.body(data, 200, {
        "Content-Type": mime,
        "Cache-Control": "public, max-age=3600",
      });
    } catch {
      return c.text("Not found", 404);
    }
  });
}
