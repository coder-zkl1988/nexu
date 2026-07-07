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
  parseVideoResultResponse,
  parseVideoTaskResponse,
  readOpenclawConfig,
  resolveLinkCredential,
  resolveOutputPath,
  validateNumFrames,
} from "./lib.js";

const SKILL_NAME = "tabby-video";
const DEFAULT_WIDTH = 1152;
const DEFAULT_HEIGHT = 768;
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
                         multi-image/keyframe video (repeatable)
      --keyframes       Treat --image entries as keyframes (requires 2+ --image)
      --negative-prompt Content to avoid in the generated video
      --width           Video width (default ${DEFAULT_WIDTH})
      --height          Video height (default ${DEFAULT_HEIGHT})
      --num-frames      Frame count, <= 441 and must follow the 8n+1 rule (default ${DEFAULT_NUM_FRAMES})
      --frame-rate      Frames per second, 1-60 (default ${DEFAULT_FRAME_RATE})
      --seed            Seed for reproducible output
      --poll-interval-ms  Polling interval while waiting for the result (default ${DEFAULT_POLL_INTERVAL_MS})
      --timeout-ms      Give up waiting for the result after this long (default ${DEFAULT_TIMEOUT_MS})
  -h, --help            Show this help`);
}

function parseCliArgs() {
  const { values } = parseArgs({
    options: {
      prompt: { type: "string", short: "p" },
      filename: { type: "string", short: "f" },
      image: { type: "string", multiple: true, default: [] },
      keyframes: { type: "boolean", default: false },
      "negative-prompt": { type: "string" },
      width: { type: "string", default: String(DEFAULT_WIDTH) },
      height: { type: "string", default: String(DEFAULT_HEIGHT) },
      "num-frames": { type: "string", default: String(DEFAULT_NUM_FRAMES) },
      "frame-rate": { type: "string", default: String(DEFAULT_FRAME_RATE) },
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
    console.error("Error: --prompt is required");
    process.exit(1);
  }
  if (!values.filename) {
    console.error("Error: --filename is required");
    process.exit(1);
  }
  if (values.keyframes && values.image.length < 2) {
    console.error("Error: --keyframes requires at least two --image values");
    process.exit(1);
  }

  return {
    prompt: values.prompt,
    filename: values.filename,
    images: values.image,
    keyframes: values.keyframes,
    negativePrompt: values["negative-prompt"],
    width: Number.parseInt(values.width, 10),
    height: Number.parseInt(values.height, 10),
    numFrames: Number.parseInt(values["num-frames"], 10),
    frameRate: Number.parseFloat(values["frame-rate"]),
    seed:
      values.seed !== undefined ? Number.parseInt(values.seed, 10) : undefined,
    pollIntervalMs: Number.parseInt(values["poll-interval-ms"], 10),
    timeoutMs: Number.parseInt(values["timeout-ms"], 10),
  };
}

function buildRequestBody(credential, args) {
  const body = {
    model: credential.model,
    prompt: args.prompt,
    width: args.width,
    height: args.height,
    num_frames: args.numFrames,
    frame_rate: args.frameRate,
  };
  if (args.negativePrompt) body.negative_prompt = args.negativePrompt;
  if (args.seed !== undefined) body.seed = args.seed;

  if (args.images.length === 1 && !args.keyframes) {
    body.image = args.images[0];
  } else if (args.images.length > 1) {
    body.extra_body = {
      image: args.images,
      ...(args.keyframes ? { mode: "keyframes" } : {}),
    };
  }

  return body;
}

/** Polling lives at the gateway's origin, not under the /v1 creation path
 *  (mirrors the upstream Agnes contract: POST is under /v1/videos, GET
 *  results are under /agnesapi at the host root). */
function resolvePollUrl(baseUrl, videoId) {
  const origin = new URL(baseUrl).origin;
  return `${origin}/agnesapi?video_id=${encodeURIComponent(videoId)}`;
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
  const pollUrl = resolvePollUrl(credential.baseUrl, task.id);
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
        `VIDEO_GENERATION_TIMEOUT: gave up waiting after ${Math.round(args.timeoutMs / 1000)}s. video_id=${task.id}`,
      );
    }
    await sleep(args.pollIntervalMs);
  }
}

async function main() {
  const args = parseCliArgs();

  try {
    validateNumFrames(args.numFrames);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  let credential;
  try {
    const config = readOpenclawConfig(process.env.OPENCLAW_STATE_DIR);
    credential = resolveLinkCredential(config, process.env.OPENCLAW_STATE_DIR);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  console.log(
    `Creating video task with model=${credential.model} size=${args.width}x${args.height} frames=${args.numFrames}@${args.frameRate}fps...`,
  );

  const createRes = await fetch(`${credential.baseUrl}/videos`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${credential.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildRequestBody(credential, args)),
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
