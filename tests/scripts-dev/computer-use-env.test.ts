import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("tools/dev Computer Use environment", () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      configurable: true,
    });
    vi.resetModules();
  });

  it("injects the CuaDriver bundle executable by absolute path on macOS", async () => {
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true,
    });
    vi.resetModules();
    const { createControllerInjectedEnv } = await import(
      "../../tools/dev/src/shared/dev-runtime-config"
    );

    const env = createControllerInjectedEnv();

    expect(env.COMPUTER_USE_BACKEND).toBe("cua-driver");
    expect(env.COMPUTER_USE_BIN).toMatch(
      /\/\.tmp\/sidecars\/computer-use\/CuaDriver\.app\/Contents\/MacOS\/cua-driver$/u,
    );
    expect(path.isAbsolute(env.OPENCLAW_BIN ?? "")).toBe(true);
    expect(env.OPENCLAW_BIN).toMatch(/\/openclaw\/bin\/openclaw$/u);
    expect(env.OPENCLAW_BIN).not.toMatch(/\.mjs$/u);
    expect(env.OPENCLAW_ELECTRON_EXECUTABLE).toBeUndefined();
  });

  it("injects CUA and an explicit Node runner on Windows", async () => {
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });
    vi.resetModules();
    const { createControllerInjectedEnv } = await import(
      "../../tools/dev/src/shared/dev-runtime-config"
    );

    const env = createControllerInjectedEnv();

    expect(env.COMPUTER_USE_BACKEND).toBe("cua-driver");
    expect(env.COMPUTER_USE_BIN).toMatch(
      /\/\.tmp\/sidecars\/computer-use\/cua-driver\.exe$/u,
    );
    expect(path.isAbsolute(env.OPENCLAW_BIN ?? "")).toBe(true);
    expect(env.OPENCLAW_BIN).toMatch(/\/openclaw\/bin\/openclaw\.cmd$/u);
    expect(env.OPENCLAW_BIN).not.toMatch(/\.mjs$/u);
    expect(env.OPENCLAW_ELECTRON_EXECUTABLE).toBe(process.execPath);
  });
});
