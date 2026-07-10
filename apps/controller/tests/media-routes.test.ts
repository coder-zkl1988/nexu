import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import type { ControllerContainer } from "../src/app/container.js";
import { registerMediaRoutes } from "../src/routes/media-routes.js";
import {
  ImageGenerationFailedError,
  InvalidMediaReferenceError,
} from "../src/services/media-generation-service.js";
import type { ControllerBindings } from "../src/types.js";

/**
 * Build the media routes with a media-generation service stub. Only the
 * generate-* methods the route handlers call need to exist; the cast narrows a
 * partial stub to the container shape (test-only, not `any`).
 */
function buildApp(
  service: Partial<ControllerContainer["mediaGenerationService"]>,
) {
  const app = new OpenAPIHono<ControllerBindings>();
  registerMediaRoutes(app, {
    mediaGenerationService: service,
  } as unknown as ControllerContainer);
  return app;
}

async function postVideo(app: ReturnType<typeof buildApp>) {
  return app.request("/api/v1/media/generate-video", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: "waves" }),
  });
}

describe("media route error mapping", () => {
  it("degrades an UNEXPECTED error to 502 (not a 500 leak)", async () => {
    // The exact regression: the utility agent missing from the openclaw config
    // makes chat.send throw a raw error. It must NOT escape to a 500 exposing
    // the agent id — it maps to a generic 502 per the contract.
    const app = buildApp({
      generateVideo: () => {
        throw new Error('Agent "580339fb" no longer exists in configuration');
      },
    });
    const res = await postVideo(app);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("生成失败，请稍后重试");
    // The internal agent id must never reach the client.
    expect(body.message).not.toContain("580339fb");
  });

  it("preserves a known ImageGenerationFailedError message at 502", async () => {
    const app = buildApp({
      generateVideo: () => {
        throw new ImageGenerationFailedError(
          "video generation backend is not configured",
        );
      },
    });
    const res = await postVideo(app);
    expect(res.status).toBe(502);
    expect((await res.json()) as { message: string }).toEqual({
      message: "video generation backend is not configured",
    });
  });

  it("maps an InvalidMediaReferenceError to 400 on generate-image", async () => {
    const app = buildApp({
      generateImage: () => {
        throw new InvalidMediaReferenceError("bad reference path");
      },
    });
    const res = await app.request("/api/v1/media/generate-image", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "cat" }),
    });
    expect(res.status).toBe(400);
  });
});
