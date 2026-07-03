#!/usr/bin/env node
/**
 * Guard: refuse to ship a tabby-control plugin bundle that is stale or missing
 * the RPC contract the controller depends on.
 *
 * The desktop→phone VLM credential push broke once because the release pipeline
 * pinned tabby-control to a branch that lagged `main` by several commits: the
 * bundled plugin was the *same version number* but older code, with no
 * `device_set_vlm_credential` RPC. The controller's push silently failed
 * (UNKNOWN_METHOD), so phones never received a credential. This check turns that
 * class of failure into a loud build error instead.
 *
 * Usage: node validate-tabby-control-bundle.mjs <plugin-dir>
 *   where <plugin-dir> contains dist/index.js and dist/build-info.json
 */
import { readFileSync } from "node:fs";
import path from "node:path";

// Minimum tabby-control version the controller's device-control contract needs.
// Bump this only when the controller starts depending on a newer plugin feature.
const REQUIRED_VERSION = "2026.3.3";

// RPC methods apps/controller/src/services/device-control-service.ts calls. A
// bundle missing any of these cannot satisfy the controller at runtime.
const REQUIRED_METHODS = ["device_set_vlm_credential", "device_push_media"];

function fail(message) {
  console.error(`::error::[validate-tabby-control] ${message}`);
  process.exit(1);
}

function compareVersions(a, b) {
  const pa = String(a)
    .split(".")
    .map((n) => Number.parseInt(n, 10) || 0);
  const pb = String(b)
    .split(".")
    .map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

const pluginDir = process.argv[2];
if (!pluginDir) {
  console.error(
    "[validate-tabby-control] usage: node validate-tabby-control-bundle.mjs <plugin-dir>",
  );
  process.exit(2);
}

let indexSource;
try {
  indexSource = readFileSync(path.join(pluginDir, "dist", "index.js"), "utf8");
} catch {
  fail(`bundled plugin has no dist/index.js at ${pluginDir}`);
}

for (const method of REQUIRED_METHODS) {
  if (!indexSource.includes(method)) {
    fail(
      `bundled tabby-control is missing RPC method "${method}" — stale plugin, refusing to ship. The CI ref must point at a tabby-control commit that has it (currently \`main\`).`,
    );
  }
}

let buildInfo;
try {
  buildInfo = JSON.parse(
    readFileSync(path.join(pluginDir, "dist", "build-info.json"), "utf8"),
  );
} catch {
  fail(
    "bundled tabby-control has no dist/build-info.json — pre-versioning build, refusing to ship. " +
      "Rebuild with `npm run build:nexu` from a tabby-control checkout that stamps build provenance.",
  );
}

if (compareVersions(buildInfo.version, REQUIRED_VERSION) < 0) {
  fail(
    `bundled tabby-control v${buildInfo.version} is older than the required v${REQUIRED_VERSION} — stale plugin, refusing to ship.`,
  );
}

console.log(
  `[validate-tabby-control] OK — v${buildInfo.version} (build ${buildInfo.gitSha}, built ${buildInfo.builtAt})`,
);
