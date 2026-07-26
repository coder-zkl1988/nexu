import { createRequire } from "node:module";
import net from "node:net";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const compatPath = resolve(
  process.cwd(),
  "packages/slimclaw/runtime-patches/openclaw/nexu-node-network-compat.cjs",
);
const patchMarker = Symbol.for("nexu.node-network-compat.setTypeOfService");
const originalMethodDescriptor = Object.getOwnPropertyDescriptor(
  net.Socket.prototype,
  "setTypeOfService",
);

function loadCompatibilityPatch(): void {
  delete require.cache[require.resolve(compatPath)];
  require(compatPath);
}

afterEach(() => {
  delete require.cache[require.resolve(compatPath)];
  delete (net.Socket.prototype as Record<PropertyKey, unknown>)[patchMarker];
  if (originalMethodDescriptor) {
    Object.defineProperty(
      net.Socket.prototype,
      "setTypeOfService",
      originalMethodDescriptor,
    );
  }
});

describe("Node network compatibility patch", () => {
  it("ignores macOS EINVAL for a valid type-of-service hint", () => {
    Object.defineProperty(net.Socket.prototype, "setTypeOfService", {
      configurable: true,
      value(typeOfService: number) {
        const error = new Error(
          `unsupported TOS ${String(typeOfService)}`,
        ) as Error & {
          code: string;
        };
        error.code = "EINVAL";
        throw error;
      },
      writable: true,
    });

    loadCompatibilityPatch();
    const socket = new net.Socket();
    expect(socket.setTypeOfService(0)).toBe(socket);
    expect(() => socket.setTypeOfService(256)).toThrow("unsupported TOS 256");
    socket.destroy();
  });

  it("does not hide errors other than EINVAL", () => {
    Object.defineProperty(net.Socket.prototype, "setTypeOfService", {
      configurable: true,
      value() {
        const error = new Error("socket is closed") as Error & { code: string };
        error.code = "EBADF";
        throw error;
      },
      writable: true,
    });

    loadCompatibilityPatch();
    const socket = new net.Socket();
    expect(() => socket.setTypeOfService(0)).toThrow("socket is closed");
    socket.destroy();
  });
});
