import fs from "node:fs";
import path from "node:path";

const VIDEO_MODEL_IDS = ["tabby-video", "tabby-video-free"];
const VIDEO_RESOLUTION_SHORT_EDGE = {
  "480p": 480,
  "720p": 720,
  "1080p": 1080,
};
const VIDEO_ASPECT_RATIOS = new Set(["16:9", "9:16", "1:1", "4:3", "3:4"]);
const DEFAULT_VIDEO_WIDTH = 1152;
const DEFAULT_VIDEO_HEIGHT = 768;
const DEFAULT_VIDEO_NUM_FRAMES = 121;

/**
 * Read and parse the OpenClaw config compiled by the Nexu controller.
 * Throws if OPENCLAW_STATE_DIR is unset or the file is missing/unparsable.
 */
export function readOpenclawConfig(stateDir) {
  if (!stateDir) {
    throw new Error(
      "ENV_MISSING: OPENCLAW_STATE_DIR is not set. This script must run inside an OpenClaw skill execution.",
    );
  }
  const configPath = path.join(stateDir, "openclaw.json");
  if (!fs.existsSync(configPath)) {
    throw new Error(`CONFIG_MISSING: ${configPath} does not exist.`);
  }
  const raw = fs.readFileSync(configPath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `CONFIG_INVALID: failed to parse ${configPath}: ${err.message}`,
    );
  }
}

/**
 * Reads the free-vs-paid routing signal the Nexu controller writes to
 * `$OPENCLAW_STATE_DIR/nexu-account-credit-state.json` (shared with
 * tabby-image — same account balance). Defaults to true — prefer the paid
 * model — when the file is missing or unreadable, so a transient read
 * failure doesn't force every user onto the free tier.
 */
export function readAccountCreditState(stateDir) {
  try {
    const raw = fs.readFileSync(
      path.join(stateDir, "nexu-account-credit-state.json"),
      "utf8",
    );
    const parsed = JSON.parse(raw);
    return parsed?.hasBalance !== false;
  } catch {
    return true;
  }
}

/**
 * Pick the tabby-video credential and model id out of an already-parsed
 * openclaw.json config object. Prefers "tabby-video" over "tabby-video-free"
 * when both are present on the account and the account has credit balance;
 * falls back to "tabby-video-free" when the balance is exhausted.
 */
export function resolveLinkCredential(config, stateDir, requestedModel) {
  const link = config?.models?.providers?.link;
  if (!link || typeof link.apiKey !== "string" || link.apiKey.length === 0) {
    throw new Error(
      "NOT_LOGGED_IN: No Tabby cloud credential found. Log into your official Tabby account in the desktop app, then try again.",
    );
  }
  if (typeof link.baseUrl !== "string" || link.baseUrl.length === 0) {
    throw new Error(
      "NOT_LOGGED_IN: No Tabby cloud credential found. Log into your official Tabby account in the desktop app, then try again.",
    );
  }

  const availableIds = new Set((link.models || []).map((m) => m.id));
  if (requestedModel !== undefined) {
    if (
      !VIDEO_MODEL_IDS.includes(requestedModel) ||
      !availableIds.has(requestedModel)
    ) {
      throw new Error(
        `NO_VIDEO_MODEL: Requested model ${requestedModel} is not available on this Tabby account.`,
      );
    }
    return {
      baseUrl: link.baseUrl,
      apiKey: link.apiKey,
      model: requestedModel,
    };
  }

  const hasBalance = readAccountCreditState(stateDir);
  const preferredOrder = hasBalance
    ? VIDEO_MODEL_IDS
    : [...VIDEO_MODEL_IDS].reverse();
  const model = preferredOrder.find((id) => availableIds.has(id));
  if (!model) {
    throw new Error(
      "NO_VIDEO_MODEL: Your Tabby account does not have access to the tabby-video model.",
    );
  }

  return { baseUrl: link.baseUrl, apiKey: link.apiKey, model };
}

/**
 * num_frames must be <= 441 and follow the 8n+1 rule (81, 121, 241, 441, ...).
 */
export function validateNumFrames(numFrames) {
  if (!Number.isInteger(numFrames) || numFrames < 1) {
    throw new Error("BAD_NUM_FRAMES: --num-frames must be a positive integer.");
  }
  if (numFrames > 441) {
    throw new Error("BAD_NUM_FRAMES: --num-frames must be <= 441.");
  }
  if ((numFrames - 1) % 8 !== 0) {
    throw new Error(
      "BAD_NUM_FRAMES: --num-frames must follow the 8n+1 rule (e.g. 81, 121, 241, 441).",
    );
  }
}

/** frame_rate must be a finite number in Agnes' documented 1-60 range. */
export function validateFrameRate(frameRate) {
  if (!Number.isFinite(frameRate) || frameRate < 1 || frameRate > 60) {
    throw new Error("BAD_FRAME_RATE: --frame-rate must be between 1 and 60.");
  }
}

/**
 * Convert an optional duration into the nearest frame count accepted by Agnes.
 * Explicit --num-frames and --duration-seconds are mutually exclusive.
 */
export function resolveVideoNumFrames({
  numFrames,
  durationSeconds,
  frameRate,
}) {
  validateFrameRate(frameRate);
  if (numFrames !== undefined && durationSeconds !== undefined) {
    throw new Error(
      "BAD_DURATION: --num-frames and --duration-seconds cannot be used together.",
    );
  }

  if (durationSeconds === undefined) {
    const resolved = numFrames ?? DEFAULT_VIDEO_NUM_FRAMES;
    validateNumFrames(resolved);
    return resolved;
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error(
      "BAD_DURATION: --duration-seconds must be a positive number.",
    );
  }

  const targetFrames = durationSeconds * frameRate;
  const nearestStep = Math.max(0, Math.round((targetFrames - 1) / 8));
  const resolved = nearestStep * 8 + 1;
  try {
    validateNumFrames(resolved);
  } catch {
    throw new Error(
      `BAD_DURATION: ${durationSeconds}s at ${frameRate}fps requires more than 441 frames. Lower the duration or frame rate.`,
    );
  }
  return resolved;
}

function roundToEven(value) {
  const rounded = Math.round(value);
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

/**
 * Resolve explicit dimensions or map a resolution/aspect pair to width/height.
 * The gateway may normalize these values to its nearest Agnes preset.
 */
export function resolveVideoDimensions({
  width,
  height,
  resolution,
  aspectRatio,
}) {
  const hasExplicitDimension = width !== undefined || height !== undefined;
  const hasPreset = resolution !== undefined || aspectRatio !== undefined;
  if (hasExplicitDimension) {
    if (hasPreset) {
      throw new Error(
        "BAD_SIZE: --width/--height cannot be combined with --resolution/--aspect-ratio.",
      );
    }
    if (
      !Number.isInteger(width) ||
      width <= 0 ||
      !Number.isInteger(height) ||
      height <= 0
    ) {
      throw new Error(
        "BAD_SIZE: --width and --height must both be positive integers.",
      );
    }
    return { width, height };
  }

  if (!hasPreset) {
    return { width: DEFAULT_VIDEO_WIDTH, height: DEFAULT_VIDEO_HEIGHT };
  }

  const resolvedResolution = resolution ?? "720p";
  const shortEdge = VIDEO_RESOLUTION_SHORT_EDGE[resolvedResolution];
  if (shortEdge === undefined) {
    throw new Error(
      "BAD_RESOLUTION: --resolution must be 480p, 720p, or 1080p.",
    );
  }
  const resolvedAspectRatio = aspectRatio ?? "16:9";
  if (!VIDEO_ASPECT_RATIOS.has(resolvedAspectRatio)) {
    throw new Error(
      "BAD_ASPECT_RATIO: --aspect-ratio must be 16:9, 9:16, 1:1, 4:3, or 3:4.",
    );
  }

  switch (resolvedAspectRatio) {
    case "16:9":
      return { width: roundToEven((shortEdge * 16) / 9), height: shortEdge };
    case "9:16":
      return { width: shortEdge, height: roundToEven((shortEdge * 16) / 9) };
    case "1:1":
      return { width: shortEdge, height: shortEdge };
    case "4:3":
      return { width: roundToEven((shortEdge * 4) / 3), height: shortEdge };
    case "3:4":
      return { width: shortEdge, height: roundToEven((shortEdge * 4) / 3) };
  }
}

/** Build the Agnes-compatible request while preserving the relay model alias. */
export function buildVideoRequestBody(credential, args) {
  const body = {
    model: credential.model,
    prompt: args.prompt,
    width: args.width,
    height: args.height,
    num_frames: args.numFrames,
    frame_rate: args.frameRate,
  };
  if (args.numInferenceSteps !== undefined) {
    body.num_inference_steps = args.numInferenceSteps;
  }
  if (args.negativePrompt) body.negative_prompt = args.negativePrompt;
  if (args.seed !== undefined) body.seed = args.seed;

  if (args.images.length > 1 && !args.keyframes) {
    throw new Error(
      "BAD_IMAGES: Multiple --image values require --keyframes mode.",
    );
  }
  if (args.keyframes && args.images.length < 2) {
    throw new Error("BAD_IMAGES: --keyframes requires at least two images.");
  }
  if (args.keyframes) {
    body.extra_body = { image: args.images, mode: "keyframes" };
  } else if (args.images.length === 1) {
    body.image = args.images[0];
  }

  return body;
}

/** Preserve the configured relay base path for POST /v1/videos. */
export function resolveVideoCreateUrl(baseUrl) {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/videos`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

/**
 * video_id uses Agnes' recommended origin-level /agnesapi endpoint. A legacy
 * task_id falls back to GET {baseUrl}/videos/<taskId>.
 */
export function resolveVideoPollUrl(baseUrl, task) {
  if (task.idParam === "video_id") {
    const url = new URL("/agnesapi", baseUrl);
    url.searchParams.set("video_id", task.id);
    return url.toString();
  }
  if (task.idParam === "task_id") {
    return `${resolveVideoCreateUrl(baseUrl)}/${encodeURIComponent(task.id)}`;
  }
  throw new Error(
    `BAD_RESPONSE: Unsupported video task id type ${task.idParam}`,
  );
}

/**
 * Extract the task/video id from a video-creation response. Prefers
 * video_id (the upstream's recommended id for polling results).
 */
export function parseVideoTaskResponse(body) {
  const videoId = body?.video_id;
  const taskId = body?.task_id ?? body?.id;
  if (typeof videoId === "string" && videoId.length > 0) {
    return { id: videoId, idParam: "video_id" };
  }
  if (typeof taskId === "string" && taskId.length > 0) {
    return { id: taskId, idParam: "task_id" };
  }
  throw new Error(
    `BAD_RESPONSE: Video creation response did not contain a video_id or task_id. Body: ${JSON.stringify(body).slice(0, 200)}`,
  );
}

/**
 * Interpret a video result poll response. status is one of
 * queued | in_progress | completed | failed. Agnes V2.0 returns the final
 * video URL in metadata.url; the legacy field remains a compatibility fallback.
 */
export function parseVideoResultResponse(body) {
  const status = body?.status;
  if (status === "completed") {
    const url = body?.metadata?.url ?? body?.remixed_from_video_id;
    if (typeof url !== "string" || url.length === 0) {
      throw new Error(
        `BAD_RESPONSE: completed video result did not contain a video URL. Body: ${JSON.stringify(body).slice(0, 200)}`,
      );
    }
    return { status, url };
  }
  if (status === "failed") {
    const message =
      typeof body?.error?.message === "string"
        ? body.error.message
        : JSON.stringify(body?.error ?? {});
    return { status, error: message };
  }
  return { status: status ?? "unknown", progress: body?.progress };
}

/**
 * Compute the absolute output path for a generated video, following the
 * same $OPENCLAW_STATE_DIR/media/outbound/{slugid}/{skillName}/{filename}
 * convention used by tabby-image.
 */
export function resolveOutputPath({ stateDir, cwd, filename, skillName }) {
  if (path.isAbsolute(filename)) {
    return filename;
  }
  return path.join(
    stateDir,
    "media",
    "outbound",
    path.basename(cwd),
    skillName,
    filename,
  );
}
