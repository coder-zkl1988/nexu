#!/usr/bin/env node
/**
 * Copies the pre-built lobster-device-control plugin into Nexu's
 * .dist-runtime/plugins/ so OpenClawRuntimePluginWriter can deploy it
 * at runtime to the OpenClaw extensions directory.
 *
 * Prerequisites:
 *   1. Check out the nexu-desktop branch in openclaw-lobster-device-control repo
 *   2. Run: node scripts/build-nexu.mjs (or pnpm build:nexu)
 *
 * Usage:
 *   node scripts/prepare-device-control-plugin.mjs
 *   DEVICE_CONTROL_PLUGIN_PATH=/custom/path node scripts/prepare-device-control-plugin.mjs
 */
import { access, cp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTROLLER_ROOT = path.resolve(__dirname, "..");
const PLUGIN_ID = "lobster-device-control";

const pluginRepoPath =
  process.env.DEVICE_CONTROL_PLUGIN_PATH ??
  path.join(os.homedir(), "workspace", "openclaw-lobster-device-control");

const sourceDir = path.join(pluginRepoPath, "dist-nexu", PLUGIN_ID);
const targetDir = path.join(
  CONTROLLER_ROOT,
  ".dist-runtime",
  "plugins",
  PLUGIN_ID,
);

try {
  await access(sourceDir);
} catch {
  console.error(
    `[device-control] Plugin build not found at: ${sourceDir}
Run first in the plugin repo (nexu-desktop branch):
  node scripts/build-nexu.mjs
Or set DEVICE_CONTROL_PLUGIN_PATH to the repo path.`,
  );
  process.exit(1);
}

await rm(targetDir, { recursive: true, force: true });
await mkdir(targetDir, { recursive: true });
await cp(sourceDir, targetDir, {
  recursive: true,
  dereference: true,
  force: true,
});

console.log(`[device-control] Plugin deployed: ${sourceDir} → ${targetDir}`);
