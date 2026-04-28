import { readFile } from "node:fs/promises";
import path from "node:path";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { ControllerContainer } from "../app/container.js";
import type { ControllerBindings } from "../types.js";

export function registerMediaRoutes(
  app: OpenAPIHono<ControllerBindings>,
  container: ControllerContainer,
): void {
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
