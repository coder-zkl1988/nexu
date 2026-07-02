#!/usr/bin/env node

/**
 * Generate an image using the official Tabby Image model (GPT-image-2),
 * served through the user's own Tabby cloud login credential — no
 * separate API key setup required.
 *
 * Usage:
 *   node generate-image.js --prompt "a cat on mars" --filename output.png
 *   node generate-image.js --prompt "a cat on mars" --filename output.png --size 1024x1536
 */

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  parseImageResponse,
  readOpenclawConfig,
  resolveLinkCredential,
  resolveOutputPath,
} from "./lib.js";

const SKILL_NAME = "tabby-image";
const DEFAULT_SIZE = "1024x1024";

function printHelp() {
  console.log(`Usage: node generate-image.js --prompt "desc" --filename "out.png" [options]

Options:
  -p, --prompt      Image description (required)
  -f, --filename    Output filename (required)
      --size        Image size, e.g. 1024x1024 (default), 1024x1536, 1536x1024
  -h, --help        Show this help`);
}

function parseCliArgs() {
  const { values } = parseArgs({
    options: {
      prompt: { type: "string", short: "p" },
      filename: { type: "string", short: "f" },
      size: { type: "string", default: DEFAULT_SIZE },
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

  return {
    prompt: values.prompt,
    filename: values.filename,
    size: values.size,
  };
}

async function downloadImage(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Failed to download generated image (${res.status}): ${url}`,
    );
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function main() {
  const args = parseCliArgs();

  let credential;
  try {
    const config = readOpenclawConfig(process.env.OPENCLAW_STATE_DIR);
    credential = resolveLinkCredential(config);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  console.log(
    `Generating image with model=${credential.model} size=${args.size}...`,
  );

  const res = await fetch(`${credential.baseUrl}/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${credential.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: credential.model,
      prompt: args.prompt,
      n: 1,
      size: args.size,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`Error from tabby-image gateway (${res.status}): ${text}`);
    process.exit(1);
  }

  let image;
  try {
    const body = await res.json();
    image = parseImageResponse(body);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  const imageBytes =
    image.kind === "b64"
      ? Buffer.from(image.data, "base64")
      : await downloadImage(image.data);

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
  fs.writeFileSync(outputPath, imageBytes);

  const stat = fs.statSync(outputPath);
  console.log(`Image saved: ${outputPath} (${Math.round(stat.size / 1024)}KB)`);
  console.log(`MEDIA: ${outputPath}`);
}

await main();
