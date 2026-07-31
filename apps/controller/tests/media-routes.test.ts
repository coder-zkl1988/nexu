import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it, vi } from "vitest";
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

async function postVideoBody(
  app: ReturnType<typeof buildApp>,
  body: Record<string, unknown>,
) {
  return app.request("/api/v1/media/generate-video", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
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

describe("video generation request validation", () => {
  it("accepts the documented Agnes parameter surface", async () => {
    const generateVideo = vi.fn(async () => ({
      path: "/state/media/out.mp4",
      url: "/api/v1/media/state-file?path=out",
      items: [
        {
          path: "/state/media/out.mp4",
          url: "/api/v1/media/state-file?path=out",
        },
      ],
    }));
    const app = buildApp({ generateVideo });

    const response = await postVideoBody(app, {
      prompt: "waves",
      resolution: "480p",
      aspectRatio: "3:4",
      numFrames: 241,
      frameRate: 30,
      numInferenceSteps: 28,
      negativePrompt: "text",
      seed: 42,
    });

    expect(response.status).toBe(200);
    expect(generateVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        resolution: "480p",
        aspectRatio: "3:4",
        numFrames: 241,
        frameRate: 30,
        numInferenceSteps: 28,
        negativePrompt: "text",
        seed: 42,
      }),
    );
  });

  it.each([
    { numFrames: 100 },
    { numFrames: 449 },
    { frameRate: 0 },
    { frameRate: 61 },
    { numInferenceSteps: 0 },
    { aspectRatio: "2:1" },
    { durationSeconds: 10, numFrames: 241 },
    { durationSeconds: 19, frameRate: 24 },
  ])("rejects invalid Agnes parameters: %o", async (invalid) => {
    const generateVideo = vi.fn();
    const app = buildApp({ generateVideo });

    const response = await postVideoBody(app, {
      prompt: "waves",
      ...invalid,
    });

    expect(response.status).toBe(400);
    expect(generateVideo).not.toHaveBeenCalled();
  });
});

describe("state media file route", () => {
  async function buildStateFileApp() {
    const root = await mkdtemp(join(tmpdir(), "nexu-state-media-"));
    const openclawStateDir = join(root, "state");
    const nexuHomeDir = join(root, "home");
    const app = new OpenAPIHono<ControllerBindings>();
    registerMediaRoutes(app, {
      mediaGenerationService: {},
      env: { openclawStateDir, nexuHomeDir },
    } as unknown as ControllerContainer);
    return { app, root, openclawStateDir };
  }

  it("serves generated Office files with the correct MIME type", async () => {
    const { app, openclawStateDir } = await buildStateFileApp();
    const officePath = join(
      openclawStateDir,
      "media",
      "officecli",
      "report.docx",
    );
    await mkdir(join(openclawStateDir, "media", "officecli"), {
      recursive: true,
    });
    await writeFile(officePath, "docx-bytes");

    const response = await app.request(
      `/api/v1/media/state-file?path=${encodeURIComponent(officePath)}`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(await response.text()).toBe("docx-bytes");
  });

  it("rejects a symlink inside media that resolves outside the media root", async () => {
    const { app, root, openclawStateDir } = await buildStateFileApp();
    const outsidePath = join(root, "private.txt");
    const linkPath = join(openclawStateDir, "media", "linked.txt");
    await mkdir(join(openclawStateDir, "media"), { recursive: true });
    await writeFile(outsidePath, "private");
    await symlink(outsidePath, linkPath);

    const response = await app.request(
      `/api/v1/media/state-file?path=${encodeURIComponent(linkPath)}`,
    );

    expect(response.status).toBe(404);
  });

  it("rejects a symlink even when its target remains inside the media root", async () => {
    const { app, openclawStateDir } = await buildStateFileApp();
    const mediaRoot = join(openclawStateDir, "media");
    const targetPath = join(mediaRoot, "target.txt");
    const linkPath = join(mediaRoot, "linked.txt");
    await mkdir(mediaRoot, { recursive: true });
    await writeFile(targetPath, "private");
    await symlink(targetPath, linkPath);

    const response = await app.request(
      `/api/v1/media/state-file?path=${encodeURIComponent(linkPath)}`,
    );

    expect(response.status).toBe(404);
  });
});

describe("prompt-cover cache proxy", () => {
  function buildCoverApp(nexuHomeDir: string) {
    const app = new OpenAPIHono<ControllerBindings>();
    registerMediaRoutes(app, {
      mediaGenerationService: {},
      env: { nexuHomeDir },
    } as unknown as ControllerContainer);
    return app;
  }

  function coverUrl(target: string) {
    return `/api/v1/media/prompt-cover?url=${encodeURIComponent(target)}`;
  }

  it("rejects missing/invalid/non-https/foreign-host urls with 404 (SSRF gate)", async () => {
    const app = buildCoverApp(await mkdtemp(join(tmpdir(), "covers-")));
    for (const target of [
      "/api/v1/media/prompt-cover",
      coverUrl("not a url"),
      coverUrl("http://raw.githubusercontent.com/a.png"), // https only
      coverUrl("https://evil.example.com/a.png"),
      coverUrl("https://raw.githubusercontent.com.evil.com/a.png"),
      coverUrl("https://192.168.1.1/a.png"),
    ]) {
      const res = await app.request(target);
      expect(res.status, target).toBe(404);
    }
  });

  it("fetches an allowed origin once, caches to disk, serves from cache after", async () => {
    const dir = await mkdtemp(join(tmpdir(), "covers-"));
    const app = buildCoverApp(dir);
    const target = "https://raw.githubusercontent.com/repo/main/cover.png";
    const bytes = new Uint8Array([137, 80, 78, 71]);

    let fetchCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return new Response(bytes, {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }) as typeof fetch;
    try {
      const first = await app.request(coverUrl(target));
      expect(first.status).toBe(200);
      expect(first.headers.get("content-type")).toBe("image/png");
      expect(new Uint8Array(await first.arrayBuffer())).toEqual(bytes);
      expect(fetchCalls).toBe(1);

      // Second request must come from the disk cache — no second origin hit.
      const second = await app.request(coverUrl(target));
      expect(second.status).toBe(200);
      expect(second.headers.get("content-type")).toBe("image/png");
      expect(fetchCalls).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects non-image content types and maps origin failure to 502", async () => {
    const dir = await mkdtemp(join(tmpdir(), "covers-"));
    const app = buildCoverApp(dir);
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async () =>
      new Response("<html></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      })) as typeof fetch;
    try {
      const res = await app.request(
        coverUrl("https://raw.githubusercontent.com/repo/main/page"),
      );
      expect(res.status).toBe(404);
    } finally {
      globalThis.fetch = originalFetch;
    }

    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    try {
      const res = await app.request(
        coverUrl("https://raw.githubusercontent.com/repo/main/cover2.png"),
      );
      expect(res.status).toBe(502);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("prompt-cover generation", () => {
  function buildGenApp(
    nexuHomeDir: string,
    generateImage: () => Promise<{ path: string }>,
  ) {
    const app = new OpenAPIHono<ControllerBindings>();
    registerMediaRoutes(app, {
      mediaGenerationService: { generateImage },
      env: { nexuHomeDir },
    } as unknown as ControllerContainer);
    return app;
  }

  async function postGenerate(
    app: OpenAPIHono<ControllerBindings>,
    id: string,
  ) {
    return app.request("/api/v1/media/prompt-cover-generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, prompt: "一只在月球上的猫" }),
    });
  }

  it("generates once, persists to disk, serves via the GET route", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gen-covers-"));
    // Fake generated image on disk (what mediaGenerationService returns).
    const generatedFile = join(dir, "generated.png");
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10]);
    await writeFile(generatedFile, bytes);

    let calls = 0;
    const app = buildGenApp(dir, async () => {
      calls += 1;
      return { path: generatedFile };
    });

    const first = await postGenerate(app, "awesome-gpt-image-0001");
    expect(first.status).toBe(200);
    const { url } = (await first.json()) as { url: string };
    expect(url).toContain("/api/v1/media/prompt-cover-generated?id=");
    expect(calls).toBe(1);

    // Second POST for the same id serves from disk — no second generation.
    const second = await postGenerate(app, "awesome-gpt-image-0001");
    expect(second.status).toBe(200);
    expect(calls).toBe(1);

    // The returned URL serves the cached bytes.
    const served = await app.request(url);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(bytes);
  });

  it("rejects malformed ids (schema) and maps generation failure to 502", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gen-covers-"));
    const app = buildGenApp(dir, async () => {
      throw new Error("backend down");
    });

    // Path-traversal-shaped id fails schema validation (400 from zod).
    const bad = await app.request("/api/v1/media/prompt-cover-generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "../escape", prompt: "x" }),
    });
    expect(bad.status).toBe(400);

    const failed = await postGenerate(app, "ok-id-1");
    expect(failed.status).toBe(502);

    // GET with traversal id is also rejected.
    const get = await app.request(
      "/api/v1/media/prompt-cover-generated?id=..%2Fescape",
    );
    expect(get.status).toBe(404);
  });
});
