import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureComputerUseDevSidecarPrepared } from "../../tools/dev/src/shared/computer-use-sidecar";

const tempRoots: string[] = [];
const ARCHIVE_SHA = "a".repeat(64);

async function createRepoRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "nexu-computer-use-preflight-"));
  tempRoots.push(root);
  await mkdir(join(root, "apps", "desktop", "scripts", "vendor"), {
    recursive: true,
  });
  await writeFile(
    join(root, "apps", "desktop", "scripts", "vendor", "computer-use.json"),
    JSON.stringify({
      mac: { backend: "cua-driver", sha256: ARCHIVE_SHA },
    }),
  );
  return root;
}

async function writeValidMacSidecar(
  root: string,
  options: { executable?: boolean } = {},
): Promise<void> {
  const sidecarRoot = join(root, ".tmp", "sidecars", "computer-use");
  const files = {
    LICENSE: "license",
    "CuaDriver.app/Contents/Info.plist": "<plist>com.trycua.driver</plist>",
    "CuaDriver.app/Contents/MacOS/cua-driver": "binary",
  };
  await mkdir(sidecarRoot, { recursive: true });
  for (const [fileName, contents] of Object.entries(files)) {
    const filePath = join(sidecarRoot, fileName);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, contents);
  }
  await chmod(
    join(sidecarRoot, "CuaDriver.app/Contents/MacOS/cua-driver"),
    options.executable === false ? 0o644 : 0o755,
  );
  await writeFile(
    join(sidecarRoot, "vendor.json"),
    JSON.stringify({
      backend: "cua-driver",
      target: "mac",
      sha256: ARCHIVE_SHA,
      files: Object.keys(files),
      fileSha256: Object.fromEntries(
        Object.entries(files).map(([fileName, contents]) => [
          fileName,
          createHash("sha256").update(contents).digest("hex"),
        ]),
      ),
    }),
  );
}

afterEach(async () => {
  await Promise.all(
    tempRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Computer Use dev sidecar preflight", () => {
  it("reuses a valid vendor-pinned sidecar", async () => {
    const root = await createRepoRoot();
    await writeValidMacSidecar(root);
    const prepare = vi.fn<() => Promise<void>>();

    await expect(
      ensureComputerUseDevSidecarPrepared({
        repoRoot: root,
        platform: "darwin",
        arch: "arm64",
        prepare,
      }),
    ).resolves.toMatchObject({ status: "cached" });
    expect(prepare).not.toHaveBeenCalled();
  });

  it("prepares a missing or stale sidecar and validates the result", async () => {
    const root = await createRepoRoot();
    const prepare = vi.fn(async () => writeValidMacSidecar(root));

    await expect(
      ensureComputerUseDevSidecarPrepared({
        repoRoot: root,
        platform: "darwin",
        arch: "arm64",
        prepare,
      }),
    ).resolves.toMatchObject({ status: "prepared" });
    expect(prepare).toHaveBeenCalledOnce();
  });

  it("re-prepares a bundle missing a required file", async () => {
    const root = await createRepoRoot();
    await writeValidMacSidecar(root);
    await rm(join(root, ".tmp", "sidecars", "computer-use", "LICENSE"));
    const prepare = vi.fn(async () => writeValidMacSidecar(root));

    await expect(
      ensureComputerUseDevSidecarPrepared({
        repoRoot: root,
        platform: "darwin",
        arch: "arm64",
        prepare,
      }),
    ).resolves.toMatchObject({ status: "prepared" });
    expect(prepare).toHaveBeenCalledOnce();
  });

  it.skipIf(process.platform === "win32")(
    "re-prepares a non-executable bundle executable",
    async () => {
      const root = await createRepoRoot();
      await writeValidMacSidecar(root, { executable: false });
      const prepare = vi.fn(async () => writeValidMacSidecar(root));

      await expect(
        ensureComputerUseDevSidecarPrepared({
          repoRoot: root,
          platform: "darwin",
          arch: "arm64",
          prepare,
        }),
      ).resolves.toMatchObject({ status: "prepared" });
      expect(prepare).toHaveBeenCalledOnce();
    },
  );

  it("fails when preparation does not produce a verified bundle", async () => {
    const root = await createRepoRoot();

    await expect(
      ensureComputerUseDevSidecarPrepared({
        repoRoot: root,
        platform: "darwin",
        arch: "arm64",
        prepare: async () => undefined,
      }),
    ).rejects.toThrow("did not produce a valid mac bundle");
  });

  it("skips unsupported platforms", async () => {
    await expect(
      ensureComputerUseDevSidecarPrepared({
        platform: "linux",
        prepare: vi.fn(),
      }),
    ).resolves.toEqual({ status: "unsupported" });
  });
});
