import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import path from "node:path";

/**
 * Copies a distribution into staging, preserving what the copy must not lose.
 *
 * On macOS the payload is a signed, notarized app bundle whose identity TCC
 * keys on. `cpSync` drops extended attributes and Finder metadata, which can
 * invalidate the signature — the packaging script uses `ditto` for exactly
 * that reason, and the runtime materialization has to match it or the first
 * packaged launch quietly re-breaks what packaging preserved. The per-file
 * hash check cannot catch this: signature metadata lives outside file bytes.
 */
function copyDistribution(sourceRoot: string, stagingRoot: string): void {
  if (process.platform === "darwin") {
    execFileSync("/usr/bin/ditto", [sourceRoot, stagingRoot]);
    return;
  }
  cpSync(sourceRoot, stagingRoot, {
    recursive: true,
    preserveTimestamps: true,
  });
}

export type ComputerUseBackend = "cua-driver";

export type ComputerUseSidecar = {
  backend: ComputerUseBackend | null;
  binPath: string | null;
};

type PlatformDescriptor = {
  backend: ComputerUseBackend;
  /**
   * Canonical "/"-separated names, matching vendor.json's digest keys exactly.
   * They double as digest-map keys and as relative paths; only the filesystem
   * access converts them to host separators. Building them with `path.join`
   * broke the digest lookup on Windows — the keys became backslashed while
   * vendor.json stayed "/", every lookup missed, and materialization failed.
   */
  binaryName: string;
  /**
   * Set on platforms that distribute an app bundle. Bundles are directories, so
   * per-file digests do not describe them; their integrity comes from the code
   * signature, which covers every file through CodeResources.
   */
  appBundle?: string;
  requiredFiles: string[];
};

/** Host path for a canonical "/"-separated file name. */
function fileOnDisk(root: string, canonicalName: string): string {
  return path.join(root, ...canonicalName.split("/"));
}

type VendorDescriptor = {
  fingerprint: string;
  fileSha256: Record<string, string>;
};

function resolvePlatformDescriptor(
  platform: NodeJS.Platform,
): PlatformDescriptor | null {
  if (platform === "darwin") {
    return {
      backend: "cua-driver",
      // The driver ships as an app bundle so it can own a TCC identity; the
      // executable inside it is what the controller invokes for CLI/MCP work.
      appBundle: "CuaDriver.app",
      binaryName: "CuaDriver.app/Contents/MacOS/cua-driver",
      // Digesting the whole bundle tree is neither cheap nor necessary: the
      // signature (verified at packaging time) covers every file. These two
      // are what a bad copy would break — the bundle identity TCC keys on,
      // and the executable itself.
      requiredFiles: [
        "LICENSE",
        "CuaDriver.app/Contents/Info.plist",
        "CuaDriver.app/Contents/MacOS/cua-driver",
      ],
    };
  }
  if (platform === "win32") {
    return {
      backend: "cua-driver",
      binaryName: "cua-driver.exe",
      requiredFiles: ["cua-driver.exe", "LICENSE"],
    };
  }
  return null;
}

function readVendorDescriptor(
  sourceRoot: string,
  expectedBackend: ComputerUseBackend,
  requiredFiles: readonly string[],
): VendorDescriptor {
  const raw = readFileSync(path.join(sourceRoot, "vendor.json"), "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("backend" in parsed) ||
    parsed.backend !== expectedBackend ||
    !("version" in parsed) ||
    typeof parsed.version !== "string" ||
    !("fileSha256" in parsed) ||
    typeof parsed.fileSha256 !== "object" ||
    parsed.fileSha256 === null ||
    Array.isArray(parsed.fileSha256)
  ) {
    throw new Error("Computer Use vendor metadata is invalid");
  }
  const fileSha256: Record<string, string> = {};
  for (const fileName of requiredFiles) {
    const digest = (parsed.fileSha256 as Record<string, unknown>)[fileName];
    if (typeof digest !== "string" || !/^[0-9a-f]{64}$/u.test(digest)) {
      throw new Error(`Computer Use digest is missing for ${fileName}`);
    }
    fileSha256[fileName] = digest;
  }
  return {
    fingerprint: createHash("sha256").update(raw).digest("hex").slice(0, 12),
    fileSha256,
  };
}

function hasValidDistribution(
  root: string,
  requiredFiles: readonly string[],
  fileSha256: Readonly<Record<string, string>>,
): boolean {
  try {
    return requiredFiles.every((fileName) => {
      const filePath = fileOnDisk(root, fileName);
      if (!existsSync(filePath)) {
        return false;
      }
      const digest = createHash("sha256")
        .update(readFileSync(filePath))
        .digest("hex");
      return digest === fileSha256[fileName];
    });
  } catch {
    return false;
  }
}

function isExecutableFile(filePath: string): boolean {
  try {
    const metadata = statSync(filePath);
    // Windows has no execute bit — libuv synthesizes one from the file
    // extension (.exe/.cmd/...), so a bundle binary with no extension always
    // reads as non-executable there. Production only consults this for app
    // bundles, which only exist on macOS hosts; the host check keeps the
    // darwin scenarios testable on Windows runners without weakening the
    // macOS lost-exec-bit repair this gate exists for.
    if (process.platform === "win32") return metadata.isFile();
    return metadata.isFile() && (metadata.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

export function prepareComputerUseSidecar(input: {
  sourceRoot: string;
  runtimeRoot: string;
  isPackaged: boolean;
  platform?: NodeJS.Platform;
  log?: (message: string) => void;
}): ComputerUseSidecar {
  const descriptor = resolvePlatformDescriptor(
    input.platform ?? process.platform,
  );
  if (!descriptor) {
    return { backend: null, binPath: null };
  }

  if (!input.isPackaged) {
    return {
      backend: descriptor.backend,
      binPath: fileOnDisk(input.sourceRoot, descriptor.binaryName),
    };
  }

  let vendor: VendorDescriptor;
  try {
    vendor = readVendorDescriptor(
      input.sourceRoot,
      descriptor.backend,
      descriptor.requiredFiles,
    );
    if (
      !hasValidDistribution(
        input.sourceRoot,
        descriptor.requiredFiles,
        vendor.fileSha256,
      )
    ) {
      throw new Error("Computer Use packaged sidecar checksum mismatch");
    }
  } catch (error: unknown) {
    input.log?.(
      `[computer-use-sidecar] vendor metadata unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return { backend: descriptor.backend, binPath: null };
  }

  const targetRoot = path.join(
    input.runtimeRoot,
    "computer-use",
    `${descriptor.backend}-${vendor.fingerprint}`,
  );
  const targetBinary = fileOnDisk(targetRoot, descriptor.binaryName);
  const hasCompleteTarget =
    hasValidDistribution(
      targetRoot,
      descriptor.requiredFiles,
      vendor.fileSha256,
    ) &&
    (!descriptor.appBundle || isExecutableFile(targetBinary));
  if (hasCompleteTarget) {
    return { backend: descriptor.backend, binPath: targetBinary };
  }

  const stagingRoot = `${targetRoot}.staging-${String(process.pid)}`;
  try {
    mkdirSync(path.dirname(targetRoot), { recursive: true });
    rmSync(stagingRoot, { recursive: true, force: true });
    copyDistribution(input.sourceRoot, stagingRoot);
    const stagingBinary = fileOnDisk(stagingRoot, descriptor.binaryName);
    if (
      !hasValidDistribution(
        stagingRoot,
        descriptor.requiredFiles,
        vendor.fileSha256,
      )
    ) {
      throw new Error("Computer Use staged sidecar checksum mismatch");
    }
    if (descriptor.appBundle) {
      chmodSync(stagingBinary, 0o755);
    }
    if (existsSync(targetRoot)) {
      rmSync(targetRoot, { recursive: true, force: true });
    }
    renameSync(stagingRoot, targetRoot);
  } catch (error: unknown) {
    rmSync(stagingRoot, { recursive: true, force: true });
    input.log?.(
      `[computer-use-sidecar] materialization failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return {
    backend: descriptor.backend,
    binPath:
      hasValidDistribution(
        targetRoot,
        descriptor.requiredFiles,
        vendor.fileSha256,
      ) &&
      (!descriptor.appBundle || isExecutableFile(targetBinary))
        ? targetBinary
        : null,
  };
}
