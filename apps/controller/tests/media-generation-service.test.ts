import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ImageGenerationFailedError,
  MediaGenerationService,
  extractMediaPath,
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

  it("returns the servable url for a file inside the media dir", async () => {
    const mediaFile = join(tmpDir, "media", "tool-image-generation", "a.png");
    rmSync(join(tmpDir, "media"), { recursive: true, force: true });
    const { mkdirSync } = await import("node:fs");
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
});
