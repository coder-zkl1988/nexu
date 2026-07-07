import { OpenAPIHono } from "@hono/zod-openapi";
import type { CanvasMirror } from "@nexu/shared";
import { afterEach, describe, expect, it } from "vitest";
import { registerCanvasRoutes } from "../src/routes/canvas-routes.js";
import { setCanvasMirror } from "../src/services/canvas-mirror-service.js";
import type { ControllerBindings } from "../src/types.js";

function buildApp() {
  const app = new OpenAPIHono<ControllerBindings>();
  registerCanvasRoutes(app);
  return app;
}

const EMPTY_DEFAULT: CanvasMirror = {
  boardId: "sidebar",
  nodes: [],
  connections: [],
  viewport: { x: 0, y: 0, scale: 1 },
  selectedNodeIds: [],
  assets: [],
};

describe("canvas mirror routes", () => {
  afterEach(() => {
    setCanvasMirror(EMPTY_DEFAULT);
  });

  it("POST then GET round-trips the pushed mirror", async () => {
    const app = buildApp();
    const mirror: CanvasMirror = {
      boardId: "sidebar",
      nodes: [
        {
          id: "node-1",
          type: "image",
          title: "Cat",
          x: 10,
          y: 20,
          w: 320,
          h: 240,
          hasContent: true,
        },
      ],
      connections: [{ id: "c1", from: "node-1", to: "node-1" }],
      viewport: { x: -5, y: 7, scale: 0.5 },
      selectedNodeIds: ["node-1"],
      assets: [{ id: "asset-1", kind: "image", title: "Saved Cat" }],
    };

    const post = await app.request("/api/v1/canvas/mirror", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(mirror),
    });
    expect(post.status).toBe(200);
    expect(await post.json()).toEqual({ ok: true });

    const get = await app.request("/api/v1/canvas/mirror");
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual(mirror);
  });

  it("GET returns the empty default before any push", async () => {
    const app = buildApp();
    const get = await app.request("/api/v1/canvas/mirror");
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual(EMPTY_DEFAULT);
  });

  it("rejects a malformed mirror body with 400", async () => {
    const app = buildApp();
    const post = await app.request("/api/v1/canvas/mirror", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ boardId: "sidebar", nodes: "not-an-array" }),
    });
    expect(post.status).toBe(400);
  });
});
