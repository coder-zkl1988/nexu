import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ImageGenerationFailedError,
  InvalidMediaReferenceError,
  MediaGenerationService,
  extractMediaPath,
  extractMediaPaths,
} from "../src/services/media-generation-service.js";

describe("extractMediaPath", () => {
  it("pulls the first media file path out of a noisy reply", () => {
    expect(
      extractMediaPath(
        "Done! Saved to /state/media/tool-image-generation/cat.png — enjoy.",
      ),
    ).toBe("/state/media/tool-image-generation/cat.png");
    expect(extractMediaPath("no path here")).toBeNull();
  });
});

describe("extractMediaPaths", () => {
  it("extracts all image paths from a multi-line reply", () => {
    const reply = [
      "/state/media/tool-image-generation/a.png",
      "/state/media/tool-image-generation/b.jpg",
      "some other text",
      "/state/media/tool-image-generation/c.webp",
    ].join("\n");
    expect(extractMediaPaths(reply, "image")).toEqual([
      "/state/media/tool-image-generation/a.png",
      "/state/media/tool-image-generation/b.jpg",
      "/state/media/tool-image-generation/c.webp",
    ]);
  });

  it("does not match video extension when kind is image", () => {
    const reply = "/state/media/videogen/clip.mp4\n/state/media/gen/img.png";
    const paths = extractMediaPaths(reply, "image");
    expect(paths).toEqual(["/state/media/gen/img.png"]);
  });

  it("extracts video paths", () => {
    const reply = "/state/media/videogen/clip.mp4\n/state/media/gen/movie.webm";
    expect(extractMediaPaths(reply, "video")).toEqual([
      "/state/media/videogen/clip.mp4",
      "/state/media/gen/movie.webm",
    ]);
  });

  it("extracts audio paths", () => {
    const reply =
      "/state/media/audiogen/track.mp3\n/state/media/audiogen/bg.wav";
    expect(extractMediaPaths(reply, "audio")).toEqual([
      "/state/media/audiogen/track.mp3",
      "/state/media/audiogen/bg.wav",
    ]);
  });

  it("extractMediaPath is an alias for first image path", () => {
    const reply = "/state/media/gen/first.png\n/state/media/gen/second.png";
    expect(extractMediaPath(reply)).toBe("/state/media/gen/first.png");
  });
});

describe("MediaGenerationService", () => {
  let tmpDir: string;
  let sendChat: ReturnType<typeof vi.fn>;
  let readSessionEntry: ReturnType<typeof vi.fn>;
  let readAssistantReply: ReturnType<typeof vi.fn>;

  function buildService() {
    return new MediaGenerationService(
      {
        pickUtilityBotId: async () => "bot-1",
        sendChat,
        readSessionEntry,
        readAssistantReply,
        openclawStateDir: tmpDir,
        genId: () => "gen-1",
      },
      { pollIntervalMs: 1, timeoutMs: 300 },
    );
  }

  function makeMediaFile(subpath: string): string {
    const full = join(tmpDir, "media", subpath);
    mkdirSync(
      join(tmpDir, "media", subpath.split("/").slice(0, -1).join("/")),
      {
        recursive: true,
      },
    );
    writeFileSync(full, "data");
    return full;
  }

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "media-gen-"));
    sendChat = vi.fn(async () => ({ status: "started" }));
    readSessionEntry = vi.fn(async () => ({
      status: "done",
      sessionFile: "/fake/session.jsonl",
    }));
    readAssistantReply = vi.fn(async () => "");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // Existing generateImage tests (must keep passing)
  // -----------------------------------------------------------------------
  it("returns the servable url for a file inside the media dir", async () => {
    const mediaFile = join(tmpDir, "media", "tool-image-generation", "a.png");
    rmSync(join(tmpDir, "media"), { recursive: true, force: true });
    mkdirSync(join(tmpDir, "media", "tool-image-generation"), {
      recursive: true,
    });
    writeFileSync(mediaFile, "png");
    readAssistantReply.mockResolvedValue(mediaFile);

    const result = await buildService().generateImage({ prompt: "a cat" });

    expect(result.path).toBe(mediaFile);
    expect(result.url).toBe(
      `/api/v1/media/state-file?path=${encodeURIComponent(mediaFile)}`,
    );
    // The utility lane got the prompt and the strict reply contract.
    const message = (sendChat.mock.calls[0]?.[0] as { message: string })
      .message;
    expect(message).toContain("a cat");
    expect(message).toContain("image_generate");
    expect(message).toContain("tabby-image");
    expect(message).toContain("ONLY the generated file's absolute path");
  });

  it("fails fast when the agent reports UNAVAILABLE (no image backend)", async () => {
    readAssistantReply.mockResolvedValue("UNAVAILABLE");
    await expect(buildService().generateImage({ prompt: "x" })).rejects.toThrow(
      /backend is not configured/,
    );
  });

  it("rejects a path that escapes the media directory", async () => {
    readAssistantReply.mockResolvedValue(
      `${tmpDir}/media/../secrets/media/x.png`,
    );
    await expect(
      buildService().generateImage({ prompt: "x" }),
    ).rejects.toBeInstanceOf(ImageGenerationFailedError);
  });

  it("fails when the reply carries no media path before the deadline", async () => {
    readAssistantReply.mockResolvedValue("sorry, I cannot");
    await expect(
      buildService().generateImage({ prompt: "x" }),
    ).rejects.toBeInstanceOf(ImageGenerationFailedError);
  });

  // -----------------------------------------------------------------------
  // generateImage + referenceImages
  // -----------------------------------------------------------------------
  it("includes the reference block in the contract when referenceImages provided", async () => {
    const ref1 = makeMediaFile("inbound/ref1.png");
    const ref2 = makeMediaFile("inbound/ref2.jpg");
    const out = makeMediaFile("tool-image-generation/out.png");
    readAssistantReply.mockResolvedValue(out);

    await buildService().generateImage({
      prompt: "a cat",
      referenceImages: [ref1, ref2],
    });

    const message = (sendChat.mock.calls[0]?.[0] as { message: string })
      .message;
    expect(message).toContain("Reference images");
    expect(message).toContain(ref1);
    expect(message).toContain(ref2);
  });

  it("throws InvalidMediaReferenceError and never calls sendChat for an invalid reference", async () => {
    await expect(
      buildService().generateImage({
        prompt: "a cat",
        referenceImages: ["/etc/passwd"],
      }),
    ).rejects.toBeInstanceOf(InvalidMediaReferenceError);

    expect(sendChat).not.toHaveBeenCalled();
  });

  it("throws InvalidMediaReferenceError for a non-existent reference file under media dir", async () => {
    const nonExistent = join(tmpDir, "media", "inbound", "missing.png");
    await expect(
      buildService().generateImage({
        prompt: "a cat",
        referenceImages: [nonExistent],
      }),
    ).rejects.toBeInstanceOf(InvalidMediaReferenceError);

    expect(sendChat).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // generateImage + count
  // -----------------------------------------------------------------------
  it("count=2: message mentions count and multi-path reply yields items.length 2", async () => {
    const out1 = makeMediaFile("tool-image-generation/a.png");
    const out2 = makeMediaFile("tool-image-generation/b.png");
    readAssistantReply.mockResolvedValue(`${out1}\n${out2}`);

    const result = await buildService().generateImage({
      prompt: "cats",
      count: 2,
    });

    const message = (sendChat.mock.calls[0]?.[0] as { message: string })
      .message;
    expect(message).toContain("2");
    expect(message).toContain("2 times");
    expect(message).not.toContain("once with this prompt.");

    expect(result.items).toHaveLength(2);
    expect(result.url).toBe(result.items[0]?.url);
    expect(result.path).toBe(result.items[0]?.path);
  });

  it("count=2 but only 1 valid path in reply → succeeds with items.length 1", async () => {
    const out1 = makeMediaFile("tool-image-generation/a.png");
    // second path is not under media dir → gets dropped, but ≥1 remains
    readAssistantReply.mockResolvedValue(`${out1}\n/etc/not-media/b.png`);

    const result = await buildService().generateImage({
      prompt: "cats",
      count: 2,
    });

    expect(result.items).toHaveLength(1);
    expect(result.path).toBe(out1);
  });

  it("deduplicates repeated valid paths in reply", async () => {
    const out1 = makeMediaFile("tool-image-generation/a.png");
    // Same path repeated twice with count=2 → deduped to 1 item
    readAssistantReply.mockResolvedValue(`${out1}\n${out1}`);

    const result = await buildService().generateImage({
      prompt: "cats",
      count: 2,
    });

    expect(result.items).toHaveLength(1);
    expect(result.path).toBe(out1);
  });

  // -----------------------------------------------------------------------
  // generateVideo
  // -----------------------------------------------------------------------
  it("generateVideo UNAVAILABLE reply → error /not configured/", async () => {
    readAssistantReply.mockResolvedValue("UNAVAILABLE");
    await expect(
      buildService().generateVideo({ prompt: "a sunset timelapse" }),
    ).rejects.toThrow(/not configured/);
  });

  it("generateVideo happy path with .mp4 → url/path returned", async () => {
    const out = makeMediaFile("tool-video-generation/clip.mp4");
    readAssistantReply.mockResolvedValue(out);

    const result = await buildService().generateVideo({
      prompt: "a sunset timelapse",
    });

    expect(result.path).toBe(out);
    expect(result.url).toContain("/api/v1/media/state-file");
    expect(result.items).toHaveLength(1);

    const message = (sendChat.mock.calls[0]?.[0] as { message: string })
      .message;
    expect(message).toContain("video");
    expect(message).toContain("UNAVAILABLE");
    expect(message).toContain("video_generate");
  });

  it("generateVideo contract includes session key with videogen prefix", async () => {
    readAssistantReply.mockResolvedValue("UNAVAILABLE");
    await expect(
      buildService().generateVideo({ prompt: "x" }),
    ).rejects.toThrow();
    const call = sendChat.mock.calls[0]?.[0] as { sessionKey: string };
    expect(call.sessionKey).toContain("videogen");
  });

  // -----------------------------------------------------------------------
  // generateAudio
  // -----------------------------------------------------------------------
  it("generateAudio UNAVAILABLE reply → error /not configured/", async () => {
    readAssistantReply.mockResolvedValue("UNAVAILABLE");
    await expect(
      buildService().generateAudio({ prompt: "background music" }),
    ).rejects.toThrow(/not configured/);
  });

  it("generateAudio happy path with .mp3 → url/path returned", async () => {
    const out = makeMediaFile("tool-audio-generation/track.mp3");
    readAssistantReply.mockResolvedValue(out);

    const result = await buildService().generateAudio({
      prompt: "background music",
    });

    expect(result.path).toBe(out);
    expect(result.url).toContain("/api/v1/media/state-file");
    expect(result.items).toHaveLength(1);

    const message = (sendChat.mock.calls[0]?.[0] as { message: string })
      .message;
    expect(message).toContain("audio");
    expect(message).toContain("UNAVAILABLE");
    expect(message).toContain("audio_generate");
  });

  it("generateAudio contract includes session key with audiogen prefix", async () => {
    readAssistantReply.mockResolvedValue("UNAVAILABLE");
    await expect(
      buildService().generateAudio({ prompt: "x" }),
    ).rejects.toThrow();
    const call = sendChat.mock.calls[0]?.[0] as { sessionKey: string };
    expect(call.sessionKey).toContain("audiogen");
  });
});
