import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createComputerUseInstanceId,
  resolveCuaAppBundle,
  resolveCuaDriverSocket,
  supportsComputerUseBackend,
} from "../src/lib/computer-use-platform.js";

describe("resolveCuaDriverSocket", () => {
  it("keeps the POSIX control socket under NEXU_HOME", () => {
    const nexuHomeDir = "/Users/test/.nexu";

    expect(resolveCuaDriverSocket({ nexuHomeDir, platform: "darwin" })).toBe(
      path.join(nexuHomeDir, "runtime", "cua-driver", "daemon.sock"),
    );
  });

  it("gives each NEXU_HOME its own Windows pipe", () => {
    const first = resolveCuaDriverSocket({
      nexuHomeDir: "C:/Users/a/.nexu",
      platform: "win32",
    });
    const second = resolveCuaDriverSocket({
      nexuHomeDir: "C:/Users/b/.nexu",
      platform: "win32",
    });

    expect(first).toContain("\\\\.\\pipe\\nexu-cua-driver-");
    // Two homes must never share a daemon.
    expect(first).not.toBe(second);
    expect(first).toContain(createComputerUseInstanceId("C:/Users/a/.nexu"));
  });
});

describe("resolveCuaAppBundle", () => {
  it("finds the bundle that owns the executable on macOS", () => {
    expect(
      resolveCuaAppBundle(
        "/Users/test/.nexu/runtime/computer-use/cua-driver-abc/CuaDriver.app/Contents/MacOS/cua-driver",
        "darwin",
      ),
    ).toBe(
      "/Users/test/.nexu/runtime/computer-use/cua-driver-abc/CuaDriver.app",
    );
  });

  it("returns null off darwin and for a bare executable", () => {
    expect(resolveCuaAppBundle("C:/nexu/cua-driver.exe", "win32")).toBeNull();
    expect(resolveCuaAppBundle("/opt/bin/cua-driver", "darwin")).toBeNull();
    expect(resolveCuaAppBundle(null, "darwin")).toBeNull();
  });
});

describe("supportsComputerUseBackend", () => {
  it("requires macOS 13, matching CuaDriver.app's LSMinimumSystemVersion", () => {
    // Darwin 22 == macOS 13.
    expect(supportsComputerUseBackend("cua-driver", "darwin", "21.6.0")).toBe(
      false,
    );
    expect(supportsComputerUseBackend("cua-driver", "darwin", "22.0.0")).toBe(
      true,
    );
    expect(supportsComputerUseBackend("cua-driver", "darwin", "27.0.0")).toBe(
      true,
    );
  });

  it("supports Windows and rejects everything else", () => {
    expect(supportsComputerUseBackend("cua-driver", "win32", "10.0.0")).toBe(
      true,
    );
    expect(supportsComputerUseBackend("cua-driver", "linux", "6.0.0")).toBe(
      false,
    );
    expect(supportsComputerUseBackend(null, "darwin", "24.0.0")).toBe(false);
  });

  it("rejects an unparseable kernel release rather than assuming support", () => {
    expect(supportsComputerUseBackend("cua-driver", "darwin", "")).toBe(false);
    expect(supportsComputerUseBackend("cua-driver", "darwin", "beta")).toBe(
      false,
    );
  });
});
