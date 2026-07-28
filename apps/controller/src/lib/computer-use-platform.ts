import { createHash } from "node:crypto";
import path from "node:path";

export type ComputerUseBackend = "peekaboo" | "cua-driver";

const MACOS_UNIX_SOCKET_PATH_MAX_BYTES = 103;

export function createComputerUseInstanceId(nexuHomeDir: string): string {
  return createHash("sha256").update(nexuHomeDir).digest("hex").slice(0, 12);
}

export function resolvePeekabooBridgeSocket(input: {
  nexuHomeDir: string;
  platform: NodeJS.Platform;
  userHomeDir: string;
}): string | null {
  const preferred = path.join(
    input.nexuHomeDir,
    "runtime",
    "peekaboo",
    "daemon.sock",
  );
  if (
    input.platform !== "darwin" ||
    Buffer.byteLength(preferred) <= MACOS_UNIX_SOCKET_PATH_MAX_BYTES
  ) {
    return preferred;
  }

  const privateSocket = path.join(
    input.userHomeDir,
    ".nexu-run",
    `peekaboo-${createComputerUseInstanceId(input.nexuHomeDir)}`,
    "daemon.sock",
  );
  if (Buffer.byteLength(privateSocket) <= MACOS_UNIX_SOCKET_PATH_MAX_BYTES) {
    return privateSocket;
  }
  return null;
}

export function supportsPeekabooPlatform(
  platform: NodeJS.Platform,
  kernelRelease: string,
): boolean {
  if (platform !== "darwin") {
    return false;
  }
  const darwinMajor = Number.parseInt(kernelRelease.split(".")[0] ?? "", 10);
  return Number.isInteger(darwinMajor) && darwinMajor >= 24;
}

export function supportsComputerUseBackend(
  backend: ComputerUseBackend | null,
  platform: NodeJS.Platform,
  kernelRelease: string,
): boolean {
  if (backend === "peekaboo") {
    return supportsPeekabooPlatform(platform, kernelRelease);
  }
  return backend === "cua-driver" && platform === "win32";
}
