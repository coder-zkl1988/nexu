import { readFile } from "node:fs/promises";
import path from "node:path";
import { type OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  generateImageRequestSchema,
  generateImageResponseSchema,
} from "@nexu/shared";
import type { ControllerContainer } from "../app/container.js";
import { mediaCacheDir, mediaCachePathFor } from "../lib/media-cache.js";
import { ImageGenerationFailedError } from "../services/media-generation-service.js";
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
