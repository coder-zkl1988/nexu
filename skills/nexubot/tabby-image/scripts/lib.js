import fs from "node:fs";
import path from "node:path";

const IMAGE_MODEL_IDS = ["tabby-image", "tabby-image-free"];

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
 * Pick the tabby-image credential and model id out of an already-parsed
 * openclaw.json config object. Prefers "tabby-image" over "tabby-image-free"
 * when both are present on the account.
 */
export function resolveLinkCredential(config) {
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
  const model = IMAGE_MODEL_IDS.find((id) => availableIds.has(id));
  if (!model) {
    throw new Error(
      "NO_IMAGE_MODEL: Your Tabby account does not have access to the tabby-image model.",
    );
  }

  return { baseUrl: link.baseUrl, apiKey: link.apiKey, model };
}

/**
 * Extract the generated image from an OpenAI-compatible images/generations
 * response body. Returns a base64 payload or a URL to download.
 */
export function parseImageResponse(body) {
  const entry = body?.data?.[0];
  if (
    entry &&
    typeof entry.b64_json === "string" &&
    entry.b64_json.length > 0
  ) {
    return { kind: "b64", data: entry.b64_json };
  }
  if (entry && typeof entry.url === "string" && entry.url.length > 0) {
    return { kind: "url", data: entry.url };
  }
  throw new Error(
    `BAD_RESPONSE: Gateway response did not contain an image. Body: ${JSON.stringify(body).slice(0, 200)}`,
  );
}

/**
 * Compute the absolute output path for a generated image, following the
 * same $OPENCLAW_STATE_DIR/media/outbound/{slugid}/{skillName}/{filename}
 * convention used by the nano-banana skill.
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
