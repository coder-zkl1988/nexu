import fs from "node:fs";
import path from "node:path";

const VIDEO_MODEL_IDS = ["tabby-video", "tabby-video-free"];

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
export function resolveLinkCredential(config, stateDir) {
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
 * queued | in_progress | completed | failed. The final video URL is
 * (confusingly) returned in `remixed_from_video_id` once completed.
 */
export function parseVideoResultResponse(body) {
  const status = body?.status;
  if (status === "completed") {
    const url = body?.remixed_from_video_id;
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
