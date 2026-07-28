import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getSidecarRoot, resetDir } from "./lib/sidecar-paths.mjs";
import { resolveBuildTargetPlatform } from "./platforms/platform-resolver.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  await readFile(resolve(scriptDir, "vendor", "computer-use.json"), "utf8"),
);
const platform = resolveBuildTargetPlatform({
  env: process.env,
  platform: process.platform,
});
const rawArch = process.env.NEXU_DESKTOP_TARGET_ARCH ?? process.arch;
const arch = rawArch === "arm64" ? "arm64" : "x64";
const target = platform === "mac" ? "mac" : `win-${arch}`;
const asset = manifest[target];

if (!asset) throw new Error(`Unsupported Computer Use target: ${target}`);

function run(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.once("error", rejectRun);
    child.once("exit", (code) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`${command} exited with code ${code}`));
    });
  });
}

function runCapture(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "inherit"],
    });
    const chunks = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.once("error", rejectRun);
    child.once("exit", (code) => {
      if (code === 0) {
        resolveRun(Buffer.concat(chunks).toString("utf8"));
      } else {
        rejectRun(new Error(`${command} exited with code ${code}`));
      }
    });
  });
}

/**
 * `codesign -dv` reports on stderr, so stdout-only capture silently yields an
 * empty string and every signature assertion against it passes vacuously.
 */
function runCaptureCombined(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => chunks.push(chunk));
    child.once("error", rejectRun);
    child.once("exit", (code) => {
      const output = Buffer.concat(chunks).toString("utf8");
      if (code === 0) {
        resolveRun(output);
      } else {
        rejectRun(new Error(`${command} exited with code ${code}: ${output}`));
      }
    });
  });
}

async function findBinary(root, names) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const entryPath = resolve(root, entry.name);
    if (entry.isDirectory()) {
      const nested = await findBinary(entryPath, names);
      if (nested) return nested;
    } else if (entry.isFile() && names.has(entry.name)) {
      return entryPath;
    }
  }
  return null;
}

async function findAppBundle(root, bundleName) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const entryPath = resolve(root, entry.name);
    if (!entry.isDirectory()) continue;
    if (entry.name === bundleName) return entryPath;
    const nested = await findAppBundle(entryPath, bundleName);
    if (nested) return nested;
  }
  return null;
}

const releaseBase = `https://github.com/trycua/cua/releases/download/cua-driver-rs-v${asset.version}`;
const response = await fetch(`${releaseBase}/${asset.file}`);
if (!response.ok) {
  throw new Error(
    `Computer Use sidecar download failed: HTTP ${response.status}`,
  );
}
const archive = Buffer.from(await response.arrayBuffer());
const digest = createHash("sha256").update(archive).digest("hex");
if (digest !== asset.sha256) {
  throw new Error(`Computer Use checksum mismatch for ${asset.file}`);
}

const tempRoot = await mkdtemp(resolve(tmpdir(), "nexu-computer-use-"));
try {
  const archivePath = resolve(tempRoot, asset.file);
  await writeFile(archivePath, archive);
  await run("tar", ["-xf", archivePath, "-C", tempRoot]);

  const sidecarRoot = getSidecarRoot("computer-use");
  await resetDir(sidecarRoot);

  let packagedFiles;
  if (platform === "mac") {
    // macOS ships the driver as CuaDriver.app. The bundle — not the bare
    // executable also present in the archive — is what carries the stapled
    // notarization ticket and the TCC identity (com.trycua.driver), so it is
    // the only thing worth distributing. Copy with ditto: cp would drop the
    // extended attributes the code signature depends on.
    const sourceBundle = await findAppBundle(tempRoot, asset.appBundle);
    if (!sourceBundle) {
      throw new Error(
        `${asset.appBundle} missing from ${basename(asset.file)}`,
      );
    }
    const bundlePath = resolve(sidecarRoot, asset.appBundle);
    await run("ditto", [sourceBundle, bundlePath]);

    // Verify what we are about to redistribute, not what we downloaded: the
    // ditto copy is the artifact that ends up in the .app payload.
    await run("codesign", ["--verify", "--deep", "--strict", bundlePath]);
    await run("codesign", [
      "-v",
      "--check-notarization",
      "-R=notarized",
      bundlePath,
    ]);
    const signingInfo = await runCaptureCombined("codesign", [
      "-dv",
      "--verbose=2",
      bundlePath,
    ]);
    if (!signingInfo.includes(`TeamIdentifier=${asset.teamId}`)) {
      throw new Error(
        `${asset.appBundle} is not signed by the expected team ${asset.teamId}; got:\n${signingInfo}`,
      );
    }
    const bundleId = (
      await runCapture("/usr/libexec/PlistBuddy", [
        "-c",
        "Print :CFBundleIdentifier",
        resolve(bundlePath, "Contents", "Info.plist"),
      ])
    ).trim();
    if (bundleId !== asset.bundleId) {
      throw new Error(
        `${asset.appBundle} declares bundle id ${bundleId}, expected ${asset.bundleId}`,
      );
    }
    // Digest the two files that carry the bundle's identity and its code, so
    // the runtime copy is verifiable without walking the whole tree. The full
    // bundle is covered by the signature verified above.
    packagedFiles = [
      `${asset.appBundle}/Contents/Info.plist`,
      `${asset.appBundle}/Contents/MacOS/cua-driver`,
    ];
  } else {
    const sourceBinary = await findBinary(
      tempRoot,
      new Set(["cua-driver.exe"]),
    );
    if (!sourceBinary) {
      throw new Error(
        `Computer Use executable missing from ${basename(asset.file)}`,
      );
    }
    await cp(sourceBinary, resolve(sidecarRoot, "cua-driver.exe"));
    packagedFiles = ["cua-driver.exe"];
  }

  const licenseResponse = await fetch(asset.licenseUrl);
  if (!licenseResponse.ok) {
    throw new Error(
      `Computer Use license download failed: HTTP ${licenseResponse.status}`,
    );
  }
  const license = Buffer.from(await licenseResponse.arrayBuffer());
  const licenseDigest = createHash("sha256").update(license).digest("hex");
  if (licenseDigest !== asset.licenseSha256) {
    throw new Error("Computer Use license checksum mismatch");
  }
  await writeFile(resolve(sidecarRoot, "LICENSE"), license);
  packagedFiles = [...packagedFiles, "LICENSE"];

  const fileSha256 = Object.fromEntries(
    await Promise.all(
      packagedFiles.map(async (fileName) => [
        fileName,
        createHash("sha256")
          .update(await readFile(resolve(sidecarRoot, fileName)))
          .digest("hex"),
      ]),
    ),
  );
  await writeFile(
    resolve(sidecarRoot, "vendor.json"),
    `${JSON.stringify({ backend: asset.backend, version: asset.version, release: asset.release, license: asset.license, target, sha256: asset.sha256, files: packagedFiles, fileSha256, ...(asset.appBundle ? { appBundle: asset.appBundle, bundleId: asset.bundleId, teamId: asset.teamId } : {}) }, null, 2)}\n`,
  );
  console.log(`[computer-use-sidecar] prepared ${sidecarRoot}`);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
