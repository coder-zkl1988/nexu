#!/usr/bin/env node

/**
 * Generate a video using the official Tabby Video model, served through the
 * user's own Tabby cloud login credential — no separate API key setup
 * required. Video generation is an async task: this script creates the task
 * and then blocks, polling for the result, before printing the MEDIA: line
 * (mirrors tabby-image's single-call-blocks-until-done shape).
 *
 * Usage:
 *   node generate-video.js --prompt "a cat walking on a beach" --filename output.mp4
 *   node generate-video.js --prompt "animate this" --filename out.mp4 --image "https://example.com/in.png"
 */

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  buildVideoRequestBody,
  parseVideoResultResponse,
  parseVideoTaskResponse,
  readOpenclawConfig,
  resolveLinkCredential,
  resolveOutputPath,
  resolveVideoCreateUrl,
  resolveVideoDimensions,
  resolveVideoNumFrames,
  resolveVideoPollUrl,
} from "./lib.js";

const SKILL_NAME = "tabby-video";
const DEFAULT_NUM_FRAMES = 121;
const DEFAULT_FRAME_RATE = 24;
const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

function printHelp() {
  console.log(`Usage: node generate-video.js --prompt "desc" --filename "out.mp4" [options]

Options:
  -p, --prompt          Video description (required)
  -f, --filename        Output filename (required)
      --image           Reference image URL. Pass once for image-to-video, twice+ for
                         keyframe video (repeatable; multiple requires --keyframes)
      --keyframes       Treat --image entries as keyframes (requires 2+ --image)
      --model           Configured relay model alias (default: account-selected tabby-video)
      --negative-prompt Content to avoid in the generated video
      --duration-seconds  Desired duration; converted to a valid 8n+1 frame count
      --resolution      480p, 720p, or 1080p (use with --aspect-ratio)
      --aspect-ratio    16:9, 9:16, 1:1, 4:3, or 3:4
      --width           Explicit video width (requires --height; cannot use preset options)
      --height          Explicit video height (requires --width; cannot use preset options)
      --num-frames      Frame count, <= 441 and must follow 8n+1 (default ${DEFAULT_NUM_FRAMES})
      --frame-rate      Frames per second, 1-60 (default ${DEFAULT_FRAME_RATE})
      --num-inference-steps  Optional positive model inference step count
      --seed            Seed for reproducible output
      --poll-interval-ms  Polling interval while waiting for the result (default ${DEFAULT_POLL_INTERVAL_MS})
      --timeout-ms      Give up waiting for the result after this long (default ${DEFAULT_TIMEOUT_MS})
  -h, --help            Show this help`);
}

function parseOptionalInteger(value, label) {
  if (value === undefined) return undefined;
  if (!/^-?\d+$/.test(value)) {
    throw new Error(`${label} must be an integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${label} must be a safe integer.`);
  }
  return parsed;
}

function parseOptionalNumber(value, label) {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a number.`);
  }
  return parsed;
}

function parsePositiveInteger(value, label) {
  const parsed = parseOptionalInteger(value, label);
  if (parsed === undefined || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function parseCliArgs() {
  const { values } = parseArgs({
    options: {
      prompt: { type: "string", short: "p" },
      filename: { type: "string", short: "f" },
      image: { type: "string", multiple: true, default: [] },
      keyframes: { type: "boolean", default: false },
      model: { type: "string" },
      "negative-prompt": { type: "string" },
      "duration-seconds": { type: "string" },
      resolution: { type: "string" },
      "aspect-ratio": { type: "string" },
      width: { type: "string" },
      height: { type: "string" },
      "num-frames": { type: "string" },
      "frame-rate": { type: "string", default: String(DEFAULT_FRAME_RATE) },
      "num-inference-steps": { type: "string" },
      seed: { type: "string" },
      "poll-interval-ms": {
        type: "string",
        default: String(DEFAULT_POLL_INTERVAL_MS),
      },
      "timeout-ms": { type: "string", default: String(DEFAULT_TIMEOUT_MS) },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }
  if (!values.prompt) {
    throw new Error("--prompt is required");
  }
  if (!values.filename) {
    throw new Error("--filename is required");
  }
  if (values.keyframes && values.image.length < 2) {
    throw new Error("--keyframes requires at least two --image values");
  }
  if (!values.keyframes && values.image.length > 1) {
    throw new Error("multiple --image values require --keyframes");
  }

  const frameRate = parseOptionalNumber(values["frame-rate"], "--frame-rate");
  const resolvedFrameRate = frameRate ?? DEFAULT_FRAME_RATE;
  const numFrames = resolveVideoNumFrames({
    numFrames: parseOptionalInteger(values["num-frames"], "--num-frames"),
    durationSeconds: parseOptionalNumber(
      values["duration-seconds"],
      "--duration-seconds",
    ),
    frameRate: resolvedFrameRate,
  });
  const dimensions = resolveVideoDimensions({
    width: parseOptionalInteger(values.width, "--width"),
    height: parseOptionalInteger(values.height, "--height"),
    resolution: values.resolution,
    aspectRatio: values["aspect-ratio"],
  });
  const seed = parseOptionalInteger(values.seed, "--seed");
  const numInferenceSteps =
    values["num-inference-steps"] === undefined
      ? undefined
      : parsePositiveInteger(
          values["num-inference-steps"],
          "--num-inference-steps",
        );

  return {
    prompt: values.prompt,
    filename: values.filename,
    images: values.image,
    keyframes: values.keyframes,
    model: values.model?.trim() || undefined,
    negativePrompt: values["negative-prompt"],
    ...dimensions,
    numFrames,
    frameRate: resolvedFrameRate,
    numInferenceSteps,
    seed,
    pollIntervalMs: parsePositiveInteger(
      values["poll-interval-ms"],
      "--poll-interval-ms",
    ),
    timeoutMs: parsePositiveInteger(values["timeout-ms"], "--timeout-ms"),
  };
}

async function downloadVideo(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Failed to download generated video (${res.status}): ${url}`,
    );
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollForResult(credential, task, args) {
  const pollUrl = resolveVideoPollUrl(credential.baseUrl, task);
  const startedAt = Date.now();
  const deadline = startedAt + args.timeoutMs;

  while (true) {
    const res = await fetch(pollUrl, {
      headers: { Authorization: `Bearer ${credential.apiKey}` },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Error polling tabby-video gateway (${res.status}): ${text}`,
      );
    }
    const body = await res.json();
    const result = parseVideoResultResponse(body);

    if (result.status === "completed") {
      return result;
    }
    if (result.status === "failed") {
      throw new Error(`VIDEO_GENERATION_FAILED: ${result.error}`);
    }

    const elapsedS = Math.round((Date.now() - startedAt) / 1000);
    console.log(
      `Polling video generation... status=${result.status}${result.progress !== undefined ? ` progress=${result.progress}%` : ""} (elapsed ${elapsedS}s)`,
    );

    if (Date.now() + args.pollIntervalMs > deadline) {
      throw new Error(
        `VIDEO_GENERATION_TIMEOUT: gave up waiting after ${Math.round(args.timeoutMs / 1000)}s. ${task.idParam}=${task.id}`,
      );
    }
    await sleep(args.pollIntervalMs);
  }
}

async function main() {
  let args;
  try {
    args = parseCliArgs();
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  let credential;
  try {
    const config = readOpenclawConfig(process.env.OPENCLAW_STATE_DIR);
    credential = resolveLinkCredential(
      config,
      process.env.OPENCLAW_STATE_DIR,
      args.model,
    );
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  console.log(
    `Creating video task with model=${credential.model} size=${args.width}x${args.height} frames=${args.numFrames}@${args.frameRate}fps...`,
  );

  const createRes = await fetch(resolveVideoCreateUrl(credential.baseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${credential.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildVideoRequestBody(credential, args)),
  });

  if (!createRes.ok) {
    const text = await createRes.text();
    console.error(
      `Error from tabby-video gateway (${createRes.status}): ${text}`,
    );
    process.exit(1);
  }

  let task;
  let result;
  try {
    const body = await createRes.json();
    task = parseVideoTaskResponse(body);
    console.log(`Video task created: ${task.idParam}=${task.id}`);
    result = await pollForResult(credential, task, args);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  const videoBytes = await downloadVideo(result.url);

  const stateDir =
    process.env.OPENCLAW_STATE_DIR ||
    path.join(process.env.HOME || process.env.USERPROFILE || "~", ".openclaw");
  const outputPath = resolveOutputPath({
    stateDir,
    cwd: process.cwd(),
    filename: args.filename,
    skillName: SKILL_NAME,
  });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, videoBytes);

  const stat = fs.statSync(outputPath);
  console.log(`Video saved: ${outputPath} (${Math.round(stat.size / 1024)}KB)`);
  console.log(`MEDIA: ${outputPath}`);
}

await main();
