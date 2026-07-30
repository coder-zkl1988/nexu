import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareComputerUseSidecar } from "../../apps/desktop/main/runtime/computer-use-sidecar";

const roots: string[] = [];

async function createRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "nexu-computer-use-sidecar-"));
  roots.push(root);
  return root;
}

async function writeSidecarFixture(
  sourceRoot: string,
  backend: "cua-driver",
  files: Record<string, string>,
): Promise<void> {
  for (const [fileName, contents] of Object.entries(files)) {
    const filePath = path.join(sourceRoot, fileName);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, contents);
  }
  const fileSha256 = Object.fromEntries(
    Object.entries(files).map(([fileName, contents]) => [
      fileName,
      createHash("sha256").update(contents).digest("hex"),
    ]),
  );
  await writeFile(
    path.join(sourceRoot, "vendor.json"),
    JSON.stringify({
      backend,
      version: "0.12.6",
      files: Object.keys(files),
      fileSha256,
    }),
  );
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("prepareComputerUseSidecar", () => {
  it("uses the prepared repo sidecar directly in development", async () => {
    const sourceRoot = await createRoot();
    const runtimeRoot = await createRoot();

    const result = prepareComputerUseSidecar({
      sourceRoot,
      runtimeRoot,
      isPackaged: false,
      platform: "darwin",
    });

    expect(result).toEqual({
      backend: "cua-driver",
      binPath: path.join(
        sourceRoot,
        "CuaDriver.app",
        "Contents",
        "MacOS",
        "cua-driver",
      ),
    });
  });

  it("materializes the CuaDriver bundle outside the app bundle", async () => {
    const sourceRoot = await createRoot();
    const runtimeRoot = await createRoot();
    await writeSidecarFixture(sourceRoot, "cua-driver", {
      LICENSE: "MIT",
      "CuaDriver.app/Contents/Info.plist": "<plist>com.trycua.driver</plist>",
      "CuaDriver.app/Contents/MacOS/cua-driver": "cua-driver-binary",
    });

    const result = prepareComputerUseSidecar({
      sourceRoot,
      runtimeRoot,
      isPackaged: true,
      platform: "darwin",
    });

    expect(result.backend).toBe("cua-driver");
    expect(result.binPath).toContain(
      path.join(runtimeRoot, "computer-use", "cua-driver-"),
    );
    // launchd must never reference anything inside the replaceable .app.
    expect(result.binPath?.startsWith(sourceRoot)).toBe(false);
    const targetRoot = path.resolve(result.binPath ?? "", "../../../..");
    expect(await readFile(result.binPath ?? "", "utf8")).toBe(
      "cua-driver-binary",
    );
    expect(await readFile(path.join(targetRoot, "LICENSE"), "utf8")).toBe(
      "MIT",
    );
    // Windows has no execute bit to assert — libuv synthesizes one from the
    // file extension only, and the bundle binary has none.
    if (process.platform !== "win32") {
      expect((await stat(result.binPath ?? "")).mode & 0o111).not.toBe(0);
    }
  });

  it("repairs an incomplete versioned distribution", async () => {
    const sourceRoot = await createRoot();
    const runtimeRoot = await createRoot();
    await writeSidecarFixture(sourceRoot, "cua-driver", {
      LICENSE: "MIT",
      "CuaDriver.app/Contents/Info.plist": "<plist>com.trycua.driver</plist>",
      "CuaDriver.app/Contents/MacOS/cua-driver": "cua-driver-binary",
    });
    const first = prepareComputerUseSidecar({
      sourceRoot,
      runtimeRoot,
      isPackaged: true,
      platform: "darwin",
    });
    const targetRoot = path.resolve(first.binPath ?? "", "../../../..");
    await rm(path.join(targetRoot, "LICENSE"));

    const repaired = prepareComputerUseSidecar({
      sourceRoot,
      runtimeRoot,
      isPackaged: true,
      platform: "darwin",
    });

    expect(repaired.binPath).toBe(first.binPath);
    expect(await readFile(path.join(targetRoot, "LICENSE"), "utf8")).toBe(
      "MIT",
    );
  });

  it("repairs a corrupted versioned distribution", async () => {
    const sourceRoot = await createRoot();
    const runtimeRoot = await createRoot();
    await writeSidecarFixture(sourceRoot, "cua-driver", {
      LICENSE: "MIT",
      "CuaDriver.app/Contents/Info.plist": "<plist>com.trycua.driver</plist>",
      "CuaDriver.app/Contents/MacOS/cua-driver": "cua-driver-binary",
    });
    const first = prepareComputerUseSidecar({
      sourceRoot,
      runtimeRoot,
      isPackaged: true,
      platform: "darwin",
    });
    await writeFile(first.binPath ?? "", "corrupt");

    const repaired = prepareComputerUseSidecar({
      sourceRoot,
      runtimeRoot,
      isPackaged: true,
      platform: "darwin",
    });

    expect(repaired.binPath).toBe(first.binPath);
    expect(await readFile(repaired.binPath ?? "", "utf8")).toBe(
      "cua-driver-binary",
    );
  });

  it.skipIf(process.platform === "win32")(
    "repairs a cached bundle executable with no executable bit",
    async () => {
      const sourceRoot = await createRoot();
      const runtimeRoot = await createRoot();
      await writeSidecarFixture(sourceRoot, "cua-driver", {
        LICENSE: "MIT",
        "CuaDriver.app/Contents/Info.plist": "<plist>com.trycua.driver</plist>",
        "CuaDriver.app/Contents/MacOS/cua-driver": "cua-driver-binary",
      });
      const first = prepareComputerUseSidecar({
        sourceRoot,
        runtimeRoot,
        isPackaged: true,
        platform: "darwin",
      });
      await chmod(first.binPath ?? "", 0o644);

      const repaired = prepareComputerUseSidecar({
        sourceRoot,
        runtimeRoot,
        isPackaged: true,
        platform: "darwin",
      });

      expect(repaired.binPath).toBe(first.binPath);
      expect((await stat(repaired.binPath ?? "")).mode & 0o111).not.toBe(0);
    },
  );

  it("fails closed when the packaged source distribution is corrupted", async () => {
    const sourceRoot = await createRoot();
    const runtimeRoot = await createRoot();
    await writeSidecarFixture(sourceRoot, "cua-driver", {
      LICENSE: "MIT",
      "CuaDriver.app/Contents/Info.plist": "<plist>com.trycua.driver</plist>",
      "CuaDriver.app/Contents/MacOS/cua-driver": "cua-driver-binary",
    });
    await writeFile(
      path.join(sourceRoot, "CuaDriver.app", "Contents", "MacOS", "cua-driver"),
      "corrupt",
    );

    const result = prepareComputerUseSidecar({
      sourceRoot,
      runtimeRoot,
      isPackaged: true,
      platform: "darwin",
    });

    expect(result).toEqual({ backend: "cua-driver", binPath: null });
  });

  it("selects CUA on Windows and no backend on unsupported platforms", async () => {
    const sourceRoot = await createRoot();
    const runtimeRoot = await createRoot();
    await writeSidecarFixture(sourceRoot, "cua-driver", {
      "cua-driver.exe": "cua",
      LICENSE: "MIT",
    });

    const windows = prepareComputerUseSidecar({
      sourceRoot,
      runtimeRoot,
      isPackaged: true,
      platform: "win32",
    });
    const linux = prepareComputerUseSidecar({
      sourceRoot,
      runtimeRoot,
      isPackaged: true,
      platform: "linux",
    });

    expect(windows.backend).toBe("cua-driver");
    expect(windows.binPath).toMatch(/cua-driver\.exe$/u);
    expect(linux).toEqual({ backend: null, binPath: null });
  });
});
