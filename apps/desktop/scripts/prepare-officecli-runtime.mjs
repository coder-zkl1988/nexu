import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBuildTargetPlatform } from "./platforms/platform-resolver.mjs";

const OFFICECLI_VERSION = "1.0.143";
const RELEASE_BASE_URL = `https://github.com/iOfficeAI/OfficeCLI/releases/download/v${OFFICECLI_VERSION}`;
const SOURCE_BASE_URL = `https://raw.githubusercontent.com/iOfficeAI/OfficeCLI/v${OFFICECLI_VERSION}`;
const ASSETS = {
  "mac-arm64": {
    name: "officecli-mac-arm64",
    sha256: "2f158d46f9b6c5eb0dfe4eb02038114001e17acc47b67347417c56dcf9659096",
  },
  "mac-x64": {
    name: "officecli-mac-x64",
    sha256: "693d243db616c74705fec9d92fdfc8a3db36acfcea378edb7264c2a30d339d9c",
  },
  "win-x64": {
    name: "officecli-win-x64.exe",
    sha256: "d4d4c10fced307e209744cf98a56b003a6e613424fd651b08469274704afd2c6",
  },
};
const ATTRIBUTION_FILES = {
  LICENSE: {
    sha256: "7e282402a5a6db33995fe638bb3fe79013f9884d8f7d15a42e481c1e86aadda1",
  },
  NOTICE: {
    sha256: "3a4715b268e148a8e9566f5e835f766f5c95c3da4d6e5ddd908806a258a2f07b",
  },
};

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(scriptDir, "..");
const targetPlatform = resolveBuildTargetPlatform({
  env: process.env,
  platform: process.platform,
});
const targetArch = process.env.NEXU_DESKTOP_TARGET_ARCH ?? process.arch;
const targetKey = `${targetPlatform}-${targetArch}`;
const asset = ASSETS[targetKey];

if (!asset) {
  throw new Error(
    `[officecli-runtime] Unsupported target ${targetKey}. Supported targets: ${Object.keys(ASSETS).join(", ")}`,
  );
}

const toolRoot = resolve(desktopRoot, ".dist-runtime", "tools", "officecli");
const binaryName = targetPlatform === "win" ? "officecli.exe" : "officecli";
const binaryPath = resolve(toolRoot, binaryName);
const metadataPath = resolve(toolRoot, "runtime.json");

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

async function readAndVerify(filePath, expectedSha256) {
  const data = await readFile(filePath);
  return sha256(data) === expectedSha256;
}

async function canReuseExistingRuntime() {
  try {
    const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    if (
      metadata.version !== OFFICECLI_VERSION ||
      metadata.target !== targetKey ||
      !(await readAndVerify(binaryPath, asset.sha256))
    ) {
      return false;
    }
    return (
      await Promise.all(
        Object.entries(ATTRIBUTION_FILES).map(([name, info]) =>
          readAndVerify(resolve(toolRoot, name), info.sha256),
        ),
      )
    ).every(Boolean);
  } catch {
    return false;
  }
}

async function downloadVerified(url, expectedSha256) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(
      `[officecli-runtime] Download failed: ${response.status} ${response.statusText}`,
    );
  }
  const data = Buffer.from(await response.arrayBuffer());
  const digest = sha256(data);
  if (digest !== expectedSha256) {
    throw new Error(
      `[officecli-runtime] SHA-256 mismatch for ${url}: expected ${expectedSha256}, received ${digest}`,
    );
  }
  return data;
}

async function main() {
  if (await canReuseExistingRuntime()) {
    console.log(
      `[officecli-runtime] reusing OfficeCLI v${OFFICECLI_VERSION} for ${targetKey}`,
    );
    return;
  }

  const binaryUrl = `${RELEASE_BASE_URL}/${asset.name}`;
  console.log(`[officecli-runtime] downloading ${binaryUrl}`);
  const [binary, ...attributionFiles] = await Promise.all([
    downloadVerified(binaryUrl, asset.sha256),
    ...Object.entries(ATTRIBUTION_FILES).map(([name, info]) =>
      downloadVerified(`${SOURCE_BASE_URL}/${name}`, info.sha256),
    ),
  ]);

  await rm(toolRoot, { recursive: true, force: true });
  await mkdir(toolRoot, { recursive: true });
  await writeFile(binaryPath, binary);
  if (targetPlatform === "mac") {
    await chmod(binaryPath, 0o755);
  }
  for (const [index, name] of Object.keys(ATTRIBUTION_FILES).entries()) {
    const data = attributionFiles[index];
    if (!data) {
      throw new Error(`[officecli-runtime] Missing downloaded ${name}`);
    }
    await writeFile(resolve(toolRoot, name), data);
  }
  await writeFile(
    metadataPath,
    `${JSON.stringify(
      {
        version: OFFICECLI_VERSION,
        target: targetKey,
        source: binaryUrl,
        sha256: asset.sha256,
        attribution: Object.fromEntries(
          Object.entries(ATTRIBUTION_FILES).map(([name, info]) => [
            name,
            {
              source: `${SOURCE_BASE_URL}/${name}`,
              sha256: info.sha256,
            },
          ]),
        ),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  console.log(
    `[officecli-runtime] staged OfficeCLI v${OFFICECLI_VERSION} at ${binaryPath}`,
  );
}

await main();
