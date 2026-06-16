import { readFile } from "node:fs/promises";
import path from "node:path";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { ControllerContainer } from "../app/container.js";
import { mediaCacheDir, mediaCachePathFor } from "../lib/media-cache.js";
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
