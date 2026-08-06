import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BundledTabbyMediaRunner,
  type RunTrustedScript,
  buildImageSkillArgs,
  buildVideoSkillArgs,
  isRetryableTabbyImageError,
  readableTabbyImageError,
} from "../src/services/bundled-tabby-media-runner.js";

describe("bundled Tabby media runner", () => {
  let root: string;
  let staticSkillsDir: string;
  let openclawStateDir: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "tabby-media-runner-"));
    staticSkillsDir = path.join(root, "bundled-skills");
    openclawStateDir = path.join(root, "state");
    for (const [skill, script] of [
      ["tabby-image", "generate-image.js"],
      ["tabby-video", "generate-video.js"],
    ] as const) {
      const scriptsDir = path.join(staticSkillsDir, skill, "scripts");
      mkdirSync(scriptsDir, { recursive: true });
      writeFileSync(path.join(scriptsDir, script), "// trusted fixture\n");
    }
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("builds image arguments without a shell command string", () => {
    expect(
      buildImageSkillArgs({
        prompt: "cat; $(touch /tmp/nope)",
        filename: "/state/out.png",
        model: "tabby-image-flash",
        quality: "high",
        aspectRatio: "9:16",
        size: "2K",
        transparentBackground: true,
      }),
    ).toEqual([
      "--prompt",
      "cat; $(touch /tmp/nope)",
      "--filename",
      "/state/out.png",
      "--model",
      "tabby-image-flash",
      "--quality",
      "high",
      "--ratio",
      "9:16",
      "--size",
      "2K",
      "--transparent-background",
    ]);
  });

  it("builds all Agnes video arguments", () => {
    expect(
      buildVideoSkillArgs({
        prompt: "ocean waves",
        filename: "/state/out.mp4",
        model: "tabby-video",
        resolution: "1080p",
        aspectRatio: "16:9",
        numFrames: 241,
        frameRate: 30,
        numInferenceSteps: 28,
        negativePrompt: "text",
        seed: 42,
        timeoutMs: 480_000,
      }),
    ).toEqual([
      "--prompt",
      "ocean waves",
      "--filename",
      "/state/out.mp4",
      "--model",
      "tabby-video",
      "--resolution",
      "1080p",
      "--aspect-ratio",
      "16:9",
      "--num-frames",
      "241",
      "--frame-rate",
      "30",
      "--num-inference-steps",
      "28",
      "--negative-prompt",
      "text",
      "--seed",
      "42",
      "--timeout-ms",
      "480000",
    ]);
  });

  it("runs only the fixed bundled script and validates the generated file", async () => {
    const runTrustedScript: RunTrustedScript = vi.fn(async (input) => {
      const filenameIndex = input.args.indexOf("--filename");
      const filename = input.args[filenameIndex + 1];
      if (!filename) throw new Error("missing filename fixture argument");
      writeFileSync(filename, "png");
    });
    const runner = new BundledTabbyMediaRunner({
      staticSkillsDir,
      openclawStateDir,
      genId: () => "image-id",
      runTrustedScript,
    });

    const paths = await runner.generateImage({
      botId: "../bot-1",
      prompt: "cat",
      count: 1,
      model: "tabby-image-flash",
      timeoutMs: 10_000,
    });

    expect(paths).toEqual([
      path.join(
        openclawStateDir,
        "media",
        "outbound",
        "bot-1",
        "tabby-image",
        "image-id.png",
      ),
    ]);
    expect(runTrustedScript).toHaveBeenCalledWith(
      expect.objectContaining({
        scriptPath: path.join(
          staticSkillsDir,
          "tabby-image",
          "scripts",
          "generate-image.js",
        ),
        timeoutMs: 10_000,
      }),
    );
  });

  it.each(["504", "524"])(
    "retries one transient gateway timeout with status %s before accepting the image",
    async (status) => {
      let attempts = 0;
      const runTrustedScript: RunTrustedScript = vi.fn(async (input) => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error(
            `Error from tabby-image gateway (${status}): <!DOCTYPE html>`,
          );
        }
        const filenameIndex = input.args.indexOf("--filename");
        const filename = input.args[filenameIndex + 1];
        if (!filename) throw new Error("missing filename fixture argument");
        writeFileSync(filename, "png");
      });
      const runner = new BundledTabbyMediaRunner({
        staticSkillsDir,
        openclawStateDir,
        genId: () => "retry-image-id",
        runTrustedScript,
        imageRetryDelayMs: 0,
      });

      await expect(
        runner.generateImage({
          botId: "bot-1",
          prompt: "cat",
          count: 1,
          model: "tabby-image-pro",
          timeoutMs: 10_000,
        }),
      ).resolves.toHaveLength(1);
      expect(runTrustedScript).toHaveBeenCalledTimes(2);
    },
  );

  it("does not retry request validation failures", async () => {
    const runTrustedScript: RunTrustedScript = vi.fn(async () => {
      throw new Error("INVALID_SIZE: unsupported");
    });
    const runner = new BundledTabbyMediaRunner({
      staticSkillsDir,
      openclawStateDir,
      genId: () => "invalid-image-id",
      runTrustedScript,
      imageRetryDelayMs: 0,
    });

    await expect(
      runner.generateImage({
        botId: "bot-1",
        prompt: "cat",
        count: 1,
        timeoutMs: 10_000,
      }),
    ).rejects.toThrow("INVALID_SIZE");
    expect(runTrustedScript).toHaveBeenCalledTimes(1);
  });

  it.each(["504", "524"])(
    "collapses an HTML gateway timeout page with status %s into a readable final error",
    (status) => {
      const error = new Error(
        `Error from tabby-image gateway (${status}): <!DOCTYPE html><html>huge page</html>`,
      );
      expect(isRetryableTabbyImageError(error)).toBe(true);
      expect(readableTabbyImageError(error).message).toBe(
        "tabby-image 中转站响应超时，已自动重试，请稍后再试",
      );
    },
  );
});
