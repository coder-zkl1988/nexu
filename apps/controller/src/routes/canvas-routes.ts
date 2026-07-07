import { type OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { canvasMirrorSchema } from "@nexu/shared";
import { z } from "zod";
import {
  getCanvasMirror,
  setCanvasMirror,
} from "../services/canvas-mirror-service.js";
import type { ControllerBindings } from "../types.js";

const mirrorAckSchema = z.object({ ok: z.literal(true) });

/**
 * S8 canvas mirror routes. The web frontend PUSHes a compact snapshot of the
 * active canvas here; the nexu-canvas runtime plugin's canvas_read GETs it back
 * over loopback so the agent can read the board before emitting ops.
 *
 * Local single-user model: no auth, in-memory only (see canvas-mirror-service).
 */
export function registerCanvasRoutes(
  app: OpenAPIHono<ControllerBindings>,
): void {
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/canvas/mirror",
      tags: ["Canvas"],
      request: {
        body: {
          content: { "application/json": { schema: canvasMirrorSchema } },
        },
      },
      responses: {
        200: {
          content: { "application/json": { schema: mirrorAckSchema } },
          description: "Mirror accepted",
        },
      },
    }),
    (c) => {
      setCanvasMirror(c.req.valid("json"));
      return c.json({ ok: true } as const, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/canvas/mirror",
      tags: ["Canvas"],
      responses: {
        200: {
          content: { "application/json": { schema: canvasMirrorSchema } },
          description: "Current canvas mirror",
        },
      },
    }),
    (c) => {
      return c.json(getCanvasMirror(), 200);
    },
  );
}
