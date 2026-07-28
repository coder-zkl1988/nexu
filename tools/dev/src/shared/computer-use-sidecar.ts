import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { repoRootPath } from "@nexu/dev-utils";

const execFileAsync = promisify(execFile);

type JsonObject = Record<string, unknown>;

export type ComputerUseDevSidecarResult =
  | { status: "unsupported" }
  | { status: "cached"; binaryPath: string }
  | { status: "prepared"; binaryPath: string };

type ComputerUseDevSidecarOptions = {
  repoRoot?: string;
  platform?: NodeJS.Platform;
  arch?: string;
  prepare?: () => Promise<void>;
};

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJsonObject(filePath: string): Promise<JsonObject | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
    return isJsonObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function sha256File(filePath: string): Promise<string | null> {
  try {
    return createHash("sha256")
      .update(await readFile(filePath))
      .digest("hex");
  } catch {
    return null;
  }
}

function resolveTarget(
  platform: NodeJS.Platform,
  arch: string,
): {
  target: string;
  backend: "peekaboo" | "cua-driver";
  binaryName: string;
  requiredFiles: string[];
} | null {
  if (platform === "darwin") {
    return {
      target: "mac",
      backend: "peekaboo",
      binaryName: "peekaboo",
      requiredFiles: ["peekaboo", "libswiftCompatibilitySpan.dylib", "LICENSE"],
    };
  }
  if (platform === "win32") {
    return {
      target: `win-${arch === "arm64" ? "arm64" : "x64"}`,
      backend: "cua-driver",
      binaryName: "cua-driver.exe",
      requiredFiles: ["cua-driver.exe", "LICENSE"],
    };
  }
  return null;
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

async function isPreparedSidecarValid(input: {
  repoRoot: string;
  target: string;
  backend: "peekaboo" | "cua-driver";
  binaryName: string;
  requiredFiles: string[];
}): Promise<boolean> {
  const manifest = await readJsonObject(
    join(
      input.repoRoot,
      "apps",
      "desktop",
      "scripts",
      "vendor",
      "computer-use.json",
    ),
  );
  const expectedAsset = manifest?.[input.target];
  if (
    !isJsonObject(expectedAsset) ||
    expectedAsset.backend !== input.backend ||
    typeof expectedAsset.sha256 !== "string" ||
    !SHA256_PATTERN.test(expectedAsset.sha256)
  ) {
    return false;
  }

  const sidecarRoot = join(input.repoRoot, ".tmp", "sidecars", "computer-use");
  const vendor = await readJsonObject(join(sidecarRoot, "vendor.json"));
  if (
    vendor?.target !== input.target ||
    vendor.backend !== input.backend ||
    vendor.sha256 !== expectedAsset.sha256 ||
    !Array.isArray(vendor.files) ||
    !isJsonObject(vendor.fileSha256)
  ) {
    return false;
  }

  const files = vendor.files.filter(
    (fileName): fileName is string => typeof fileName === "string",
  );
  if (
    files.length !== vendor.files.length ||
    new Set(files).size !== files.length ||
    files.some(
      (fileName) => fileName.length === 0 || fileName !== basename(fileName),
    ) ||
    input.requiredFiles.some((fileName) => !files.includes(fileName))
  ) {
    return false;
  }

  for (const fileName of files) {
    const expectedFileSha = vendor.fileSha256[fileName];
    if (
      typeof expectedFileSha !== "string" ||
      !SHA256_PATTERN.test(expectedFileSha) ||
      (await sha256File(join(sidecarRoot, fileName))) !== expectedFileSha
    ) {
      return false;
    }
  }

  if (input.backend === "peekaboo" && process.platform !== "win32") {
    try {
      const binaryMetadata = await stat(join(sidecarRoot, input.binaryName));
      if (!binaryMetadata.isFile() || (binaryMetadata.mode & 0o111) === 0) {
        return false;
      }
    } catch {
      return false;
    }
  }

  return true;
}

export async function ensureComputerUseDevSidecarPrepared(
  options: ComputerUseDevSidecarOptions = {},
): Promise<ComputerUseDevSidecarResult> {
  const repoRoot = options.repoRoot ?? repoRootPath;
  const platform = options.platform ?? process.platform;
  const target = resolveTarget(platform, options.arch ?? process.arch);
  if (!target) {
    return { status: "unsupported" };
  }

  const binaryPath = join(
    repoRoot,
    ".tmp",
    "sidecars",
    "computer-use",
    target.binaryName,
  );
  if (await isPreparedSidecarValid({ repoRoot, ...target })) {
    return { status: "cached", binaryPath };
  }

  const prepare =
    options.prepare ??
    (async () => {
      await execFileAsync(
        process.execPath,
        [
          join(
            repoRoot,
            "apps",
            "desktop",
            "scripts",
            "prepare-computer-use-sidecar.mjs",
          ),
        ],
        {
          cwd: repoRoot,
          env: { ...process.env, NEXU_WORKSPACE_ROOT: repoRoot },
          maxBuffer: 16 * 1024 * 1024,
        },
      );
    });
  await prepare();

  if (!(await isPreparedSidecarValid({ repoRoot, ...target }))) {
    throw new Error(
      `Computer Use sidecar preparation did not produce a valid ${target.target} bundle`,
    );
  }

  return { status: "prepared", binaryPath };
}
