import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  buildVideoRequestBody,
  parseVideoResultResponse,
  parseVideoTaskResponse,
  readAccountCreditState,
  readOpenclawConfig,
  resolveLinkCredential,
  resolveOutputPath,
  resolveVideoCreateUrl,
  resolveVideoDimensions,
  resolveVideoNumFrames,
  resolveVideoPollUrl,
  validateFrameRate,
  validateNumFrames,
} from "./lib.js";

test("readOpenclawConfig throws ENV_MISSING when stateDir is falsy", () => {
  assert.throws(() => readOpenclawConfig(undefined), /ENV_MISSING/);
});

test("readOpenclawConfig throws CONFIG_MISSING when the file does not exist", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tabby-video-test-"));
  assert.throws(() => readOpenclawConfig(dir), /CONFIG_MISSING/);
});

test("resolveLinkCredential throws NOT_LOGGED_IN when the link provider is missing", () => {
  assert.throws(() => resolveLinkCredential({}), /NOT_LOGGED_IN/);
});

test("resolveLinkCredential throws NO_VIDEO_MODEL when neither variant is present", () => {
  const config = {
    models: {
      providers: {
        link: {
          baseUrl: "https://x/v1",
          apiKey: "key123",
          models: [{ id: "gpt-5.5" }],
        },
      },
    },
  };
  assert.throws(() => resolveLinkCredential(config), /NO_VIDEO_MODEL/);
});

test("resolveLinkCredential prefers tabby-video over tabby-video-free", () => {
  const config = {
    models: {
      providers: {
        link: {
          baseUrl: "https://x/v1",
          apiKey: "key123",
          models: [{ id: "tabby-video-free" }, { id: "tabby-video" }],
        },
      },
    },
  };
  const result = resolveLinkCredential(config);
  assert.equal(result.model, "tabby-video");
});

test("resolveLinkCredential falls back to tabby-video-free when the account has no balance", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tabby-video-test-"));
  fs.writeFileSync(
    path.join(dir, "nexu-account-credit-state.json"),
    JSON.stringify({ hasBalance: false }),
  );
  const config = {
    models: {
      providers: {
        link: {
          baseUrl: "https://x/v1",
          apiKey: "key123",
          models: [{ id: "tabby-video" }, { id: "tabby-video-free" }],
        },
      },
    },
  };
  const result = resolveLinkCredential(config, dir);
  assert.equal(result.model, "tabby-video-free");
});

test("resolveLinkCredential honors an available requested relay alias", () => {
  const config = {
    models: {
      providers: {
        link: {
          baseUrl: "https://relay.example/v1",
          apiKey: "key123",
          models: [{ id: "tabby-video" }, { id: "tabby-video-free" }],
        },
      },
    },
  };
  const result = resolveLinkCredential(config, undefined, "tabby-video");
  assert.equal(result.baseUrl, "https://relay.example/v1");
  assert.equal(result.model, "tabby-video");
});

test("resolveLinkCredential rejects an upstream model name not exposed by the relay", () => {
  const config = {
    models: {
      providers: {
        link: {
          baseUrl: "https://relay.example/v1",
          apiKey: "key123",
          models: [{ id: "tabby-video" }],
        },
      },
    },
  };
  assert.throws(
    () => resolveLinkCredential(config, undefined, "agnes-video-v2.0"),
    /NO_VIDEO_MODEL/,
  );
});

test("readAccountCreditState defaults to true when the state file is missing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tabby-video-test-"));
  assert.equal(readAccountCreditState(dir), true);
});

test("validateNumFrames accepts values following the 8n+1 rule", () => {
  assert.doesNotThrow(() => validateNumFrames(81));
  assert.doesNotThrow(() => validateNumFrames(121));
  assert.doesNotThrow(() => validateNumFrames(441));
});

test("validateNumFrames rejects values above 441", () => {
  assert.throws(() => validateNumFrames(449), /BAD_NUM_FRAMES/);
});

test("validateNumFrames rejects values that don't follow the 8n+1 rule", () => {
  assert.throws(() => validateNumFrames(100), /BAD_NUM_FRAMES/);
});

test("validateNumFrames rejects non-positive-integer input", () => {
  assert.throws(() => validateNumFrames(0), /BAD_NUM_FRAMES/);
  assert.throws(() => validateNumFrames(1.5), /BAD_NUM_FRAMES/);
});

test("validateFrameRate accepts 1-60 and rejects out-of-range values", () => {
  assert.doesNotThrow(() => validateFrameRate(1));
  assert.doesNotThrow(() => validateFrameRate(24));
  assert.doesNotThrow(() => validateFrameRate(60));
  assert.throws(() => validateFrameRate(0), /BAD_FRAME_RATE/);
  assert.throws(() => validateFrameRate(61), /BAD_FRAME_RATE/);
  assert.throws(() => validateFrameRate(Number.NaN), /BAD_FRAME_RATE/);
});

test("resolveVideoNumFrames maps duration to the nearest 8n+1 count", () => {
  assert.equal(
    resolveVideoNumFrames({ durationSeconds: 5, frameRate: 24 }),
    121,
  );
  assert.equal(
    resolveVideoNumFrames({ durationSeconds: 10, frameRate: 24 }),
    241,
  );
});

test("resolveVideoNumFrames rejects conflicting or oversized duration input", () => {
  assert.throws(
    () =>
      resolveVideoNumFrames({
        numFrames: 121,
        durationSeconds: 5,
        frameRate: 24,
      }),
    /BAD_DURATION/,
  );
  assert.throws(
    () => resolveVideoNumFrames({ durationSeconds: 20, frameRate: 24 }),
    /BAD_DURATION/,
  );
});

test("resolveVideoDimensions maps resolution and aspect ratio to dimensions", () => {
  assert.deepEqual(
    resolveVideoDimensions({ resolution: "720p", aspectRatio: "16:9" }),
    { width: 1280, height: 720 },
  );
  assert.deepEqual(
    resolveVideoDimensions({ resolution: "720p", aspectRatio: "9:16" }),
    { width: 720, height: 1280 },
  );
  assert.deepEqual(
    resolveVideoDimensions({ resolution: "1080p", aspectRatio: "4:3" }),
    { width: 1440, height: 1080 },
  );
});

test("resolveVideoDimensions preserves explicit dimensions and rejects ambiguity", () => {
  assert.deepEqual(resolveVideoDimensions({ width: 1152, height: 768 }), {
    width: 1152,
    height: 768,
  });
  assert.throws(
    () =>
      resolveVideoDimensions({
        width: 1280,
        height: 720,
        resolution: "720p",
      }),
    /BAD_SIZE/,
  );
});

test("parseVideoTaskResponse prefers video_id", () => {
  const result = parseVideoTaskResponse({
    id: "task_1",
    task_id: "task_1",
    video_id: "video_1",
  });
  assert.deepEqual(result, { id: "video_1", idParam: "video_id" });
});

test("parseVideoTaskResponse falls back to task_id when video_id is absent", () => {
  const result = parseVideoTaskResponse({ task_id: "task_1" });
  assert.deepEqual(result, { id: "task_1", idParam: "task_id" });
});

test("parseVideoTaskResponse throws BAD_RESPONSE when neither id is present", () => {
  assert.throws(() => parseVideoTaskResponse({}), /BAD_RESPONSE/);
});

test("parseVideoResultResponse returns metadata.url when completed", () => {
  const result = parseVideoResultResponse({
    status: "completed",
    metadata: { url: "https://example.com/video.mp4" },
  });
  assert.deepEqual(result, {
    status: "completed",
    url: "https://example.com/video.mp4",
  });
});

test("parseVideoResultResponse keeps the legacy result field as fallback", () => {
  const result = parseVideoResultResponse({
    status: "completed",
    remixed_from_video_id: "https://example.com/legacy.mp4",
  });
  assert.equal(result.url, "https://example.com/legacy.mp4");
});

test("parseVideoResultResponse throws BAD_RESPONSE when completed without a URL", () => {
  assert.throws(
    () => parseVideoResultResponse({ status: "completed" }),
    /BAD_RESPONSE/,
  );
});

test("parseVideoResultResponse surfaces the error message when failed", () => {
  const result = parseVideoResultResponse({
    status: "failed",
    error: { message: "quota exceeded" },
  });
  assert.deepEqual(result, { status: "failed", error: "quota exceeded" });
});

test("parseVideoResultResponse passes through in-progress status and progress", () => {
  const result = parseVideoResultResponse({
    status: "in_progress",
    progress: 42,
  });
  assert.deepEqual(result, { status: "in_progress", progress: 42 });
});

test("buildVideoRequestBody preserves tabby-video alias and Agnes field names", () => {
  const body = buildVideoRequestBody(
    { model: "tabby-video" },
    {
      prompt: "ocean waves",
      width: 1280,
      height: 720,
      numFrames: 121,
      frameRate: 24,
      numInferenceSteps: 28,
      negativePrompt: "text overlays",
      seed: 42,
      images: [],
      keyframes: false,
    },
  );
  assert.deepEqual(body, {
    model: "tabby-video",
    prompt: "ocean waves",
    width: 1280,
    height: 720,
    num_frames: 121,
    frame_rate: 24,
    num_inference_steps: 28,
    negative_prompt: "text overlays",
    seed: 42,
  });
});

test("buildVideoRequestBody uses image for one image and extra_body for keyframes", () => {
  const base = {
    prompt: "animate",
    width: 720,
    height: 1280,
    numFrames: 121,
    frameRate: 24,
  };
  const single = buildVideoRequestBody(
    { model: "tabby-video" },
    { ...base, images: ["https://example.com/a.png"], keyframes: false },
  );
  assert.equal(single.image, "https://example.com/a.png");
  assert.equal(single.extra_body, undefined);

  const keyframes = buildVideoRequestBody(
    { model: "tabby-video" },
    {
      ...base,
      images: ["https://example.com/a.png", "https://example.com/b.png"],
      keyframes: true,
    },
  );
  assert.deepEqual(keyframes.extra_body, {
    image: ["https://example.com/a.png", "https://example.com/b.png"],
    mode: "keyframes",
  });
  assert.equal(keyframes.image, undefined);
});

test("buildVideoRequestBody rejects undocumented multi-image mode", () => {
  assert.throws(
    () =>
      buildVideoRequestBody(
        { model: "tabby-video" },
        {
          prompt: "blend",
          width: 1280,
          height: 720,
          numFrames: 121,
          frameRate: 24,
          images: ["https://example.com/a.png", "https://example.com/b.png"],
          keyframes: false,
        },
      ),
    /BAD_IMAGES/,
  );
});

test("video URLs preserve the configured relay and use each documented path", () => {
  const baseUrl = "https://tabbyapi.picaso.studio/v1/";
  assert.equal(
    resolveVideoCreateUrl(baseUrl),
    "https://tabbyapi.picaso.studio/v1/videos",
  );
  assert.equal(
    resolveVideoPollUrl(baseUrl, { id: "video_1", idParam: "video_id" }),
    "https://tabbyapi.picaso.studio/agnesapi?video_id=video_1",
  );
  assert.equal(
    resolveVideoPollUrl(baseUrl, { id: "task 1", idParam: "task_id" }),
    "https://tabbyapi.picaso.studio/v1/videos/task%201",
  );
});

test("resolveOutputPath returns an absolute filename as-is", () => {
  const result = resolveOutputPath({
    stateDir: "/state",
    cwd: "/workspace/my-bot",
    filename: "/tmp/out.mp4",
    skillName: "tabby-video",
  });
  assert.equal(result, "/tmp/out.mp4");
});

test("resolveOutputPath builds the outbound media path for relative filenames", () => {
  const result = resolveOutputPath({
    stateDir: "/state",
    cwd: "/workspace/my-bot",
    filename: "cat.mp4",
    skillName: "tabby-video",
  });
  assert.equal(
    result,
    path.join(
      "/state",
      "media",
      "outbound",
      "my-bot",
      "tabby-video",
      "cat.mp4",
    ),
  );
});
