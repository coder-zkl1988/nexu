import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
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

const releaseBase =
  asset.backend === "peekaboo"
    ? `https://github.com/openclaw/Peekaboo/releases/download/v${asset.version}`
    : `https://github.com/trycua/cua/releases/download/cua-driver-rs-v${asset.version}`;
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
  const binaryNames =
    asset.backend === "peekaboo"
      ? new Set(["peekaboo"])
      : new Set(["cua-driver.exe"]);
  const sourceBinary = await findBinary(tempRoot, binaryNames);
  if (!sourceBinary) {
    throw new Error(
      `Computer Use executable missing from ${basename(asset.file)}`,
    );
  }

  const sidecarRoot = getSidecarRoot("computer-use");
  await resetDir(sidecarRoot);
  const outputName =
    asset.backend === "peekaboo" ? "peekaboo" : "cua-driver.exe";
  const outputPath = resolve(sidecarRoot, outputName);
  await cp(sourceBinary, outputPath);
  if (platform !== "win") {
    const sourceRoot = dirname(sourceBinary);
    const compatibilityLibraryName = "libswiftCompatibilitySpan.dylib";
    const compatibilityLibraryPath = resolve(
      sidecarRoot,
      compatibilityLibraryName,
    );
    await cp(
      resolve(sourceRoot, compatibilityLibraryName),
      compatibilityLibraryPath,
    );
    await cp(resolve(sourceRoot, "LICENSE"), resolve(sidecarRoot, "LICENSE"));
    await chmod(outputPath, 0o755);
    await run("codesign", ["--verify", "--deep", "--strict", outputPath]);
    await run("codesign", ["--verify", "--strict", compatibilityLibraryPath]);
    await run("codesign", [
      "-v",
      "--check-notarization",
      "-R=notarized",
      outputPath,
    ]);
    const dependencies = await runCapture("otool", ["-L", outputPath]);
    if (!dependencies.includes(`@rpath/${compatibilityLibraryName}`)) {
      throw new Error(
        `Peekaboo does not declare the expected ${compatibilityLibraryName} dependency`,
      );
    }
  } else {
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
  }
  const packagedFiles =
    asset.backend === "peekaboo"
      ? ["peekaboo", "libswiftCompatibilitySpan.dylib", "LICENSE"]
      : ["cua-driver.exe", "LICENSE"];
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
    `${JSON.stringify({ backend: asset.backend, version: asset.version, release: asset.release, license: asset.license, target, sha256: asset.sha256, files: packagedFiles, fileSha256 }, null, 2)}\n`,
  );
  console.log(`[computer-use-sidecar] prepared ${outputPath}`);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
