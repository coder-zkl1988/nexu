import { createHash } from "node:crypto";
import path from "node:path";

export type ComputerUseBackend = "cua-driver";

/**
 * CuaDriver.app declares `LSMinimumSystemVersion 13.0`, so macOS 13 (Darwin 22)
 * is the floor. This is wider than the macOS 15 floor the Peekaboo backend
 * required before the backends were unified.
 */
const MIN_DARWIN_MAJOR = 22;

export function createComputerUseInstanceId(nexuHomeDir: string): string {
  return createHash("sha256").update(nexuHomeDir).digest("hex").slice(0, 12);
}

/**
 * Control socket for the cua-driver daemon. Windows uses a named pipe; macOS
 * uses a Unix domain socket under NEXU_HOME.
 *
 * Unlike the Peekaboo bridge socket this replaced, the path is not subject to
 * the 103-byte `sun_path` limit: the daemon is addressed through the driver's
 * own socket handling rather than a raw bind from this process, and the driver
 * is launched from its app bundle. Keep it under NEXU_HOME so instances with
 * different homes never share a daemon.
 */
export function resolveCuaDriverSocket(input: {
  nexuHomeDir: string;
  platform: NodeJS.Platform;
}): string {
  if (input.platform === "win32") {
    return `\\\\.\\pipe\\nexu-cua-driver-${createComputerUseInstanceId(input.nexuHomeDir)}`;
  }
  return path.join(input.nexuHomeDir, "runtime", "cua-driver", "daemon.sock");
}

/**
 * macOS TCC grants attach to CuaDriver.app's signed bundle identity
 * (com.trycua.driver), not to the executable path. The daemon therefore has to
 * be launched as the app — running `Contents/MacOS/cua-driver` directly makes
 * the controller the responsible process and the driver reports no grants.
 *
 * Returns null off darwin, or when the binary is not inside an app bundle.
 */
export function resolveCuaAppBundle(
  binPath: string | null,
  platform: NodeJS.Platform,
): string | null {
  if (platform !== "darwin" || !binPath) {
    return null;
  }
  // <bundle>.app/Contents/MacOS/cua-driver -> <bundle>.app
  const bundle = path.dirname(path.dirname(path.dirname(binPath)));
  return path.extname(bundle) === ".app" ? bundle : null;
}

export function supportsComputerUseBackend(
  backend: ComputerUseBackend | null,
  platform: NodeJS.Platform,
  kernelRelease: string,
): boolean {
  if (backend !== "cua-driver") {
    return false;
  }
  if (platform === "win32") {
    return true;
  }
  if (platform !== "darwin") {
    return false;
  }
  const darwinMajor = Number.parseInt(kernelRelease.split(".")[0] ?? "", 10);
  return Number.isInteger(darwinMajor) && darwinMajor >= MIN_DARWIN_MAJOR;
}
