import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createComputerUseInstanceId,
  resolvePeekabooBridgeSocket,
} from "../src/lib/computer-use-platform.js";

describe("resolvePeekabooBridgeSocket", () => {
  it("keeps a short macOS socket under NEXU_HOME", () => {
    const nexuHomeDir = "/Users/test/.nexu";

    expect(
      resolvePeekabooBridgeSocket({
        nexuHomeDir,
        platform: "darwin",
        userHomeDir: "/Users/test",
      }),
    ).toBe(path.join(nexuHomeDir, "runtime", "peekaboo", "daemon.sock"));
  });

  it("uses a stable private home path when NEXU_HOME is too long", () => {
    const nexuHomeDir = path.join(
      "/Users/test",
      "nested-worktree-directory".repeat(8),
    );
    const socketPath = resolvePeekabooBridgeSocket({
      nexuHomeDir,
      platform: "darwin",
      userHomeDir: "/Users/test",
    });

    expect(socketPath).toBe(
      path.join(
        "/Users/test",
        ".nexu-run",
        `peekaboo-${createComputerUseInstanceId(nexuHomeDir)}`,
        "daemon.sock",
      ),
    );
    expect(Buffer.byteLength(socketPath)).toBeLessThanOrEqual(103);
  });

  it("reports the socket unavailable when no private path fits the macOS limit", () => {
    const nexuHomeDir = path.join("/Users/test", "n".repeat(120));

    expect(
      resolvePeekabooBridgeSocket({
        nexuHomeDir,
        platform: "darwin",
        userHomeDir: path.join("/Users", "h".repeat(120)),
      }),
    ).toBeNull();
  });
});
