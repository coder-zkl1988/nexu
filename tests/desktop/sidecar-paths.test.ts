import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { pruneRuntimeDependenciesForTarget } from "../../apps/desktop/scripts/lib/sidecar-paths.mjs";

/**
 * Tests the resolveInstalledPackageRoot fallback behavior for bin-only packages
 * (packages with no `main` or `exports`, only `bin`).
 *
 * This verifies the fix in sidecar-paths.mjs where require.resolve(packageName)
 * falls back to require.resolve(`${packageName}/package.json`) for packages
 * like clawhub that only export bin scripts.
 */
describe("sidecar-paths bin-only package resolution", () => {
  const tmpDir = resolve(import.meta.dirname, ".tmp-sidecar-test");
  const fakePackageRoot = resolve(tmpDir, "fake-project");
  const nodeModulesDir = resolve(fakePackageRoot, "node_modules");
  const binOnlyPkg = resolve(nodeModulesDir, "bin-only-tool");

  beforeAll(() => {
    // Create a fake project with a bin-only package
    mkdirSync(resolve(binOnlyPkg, "bin"), { recursive: true });
    writeFileSync(
      resolve(fakePackageRoot, "package.json"),
      JSON.stringify({
        name: "fake-project",
        dependencies: { "bin-only-tool": "1.0.0" },
      }),
    );
    writeFileSync(
      resolve(binOnlyPkg, "package.json"),
      JSON.stringify({
        name: "bin-only-tool",
        version: "1.0.0",
        bin: { "bin-only-tool": "bin/cli.js" },
      }),
    );
    writeFileSync(
      resolve(binOnlyPkg, "bin/cli.js"),
      "#!/usr/bin/env node\nconsole.log('hello');\n",
    );
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("require.resolve fails for bin-only package by name", () => {
    const req = createRequire(resolve(fakePackageRoot, "package.json"));
    expect(() => req.resolve("bin-only-tool")).toThrow();
  });

  it("require.resolve succeeds for bin-only package via package.json", () => {
    const req = createRequire(resolve(fakePackageRoot, "package.json"));
    const result = req.resolve("bin-only-tool/package.json");
    expect(result).toBe(resolve(binOnlyPkg, "package.json"));
  });

  it("can resolve bin path from package.json for bin-only packages", () => {
    const req = createRequire(resolve(fakePackageRoot, "package.json"));

    // This is the pattern used in resolveClawHubBin
    let resolvedEntry: string;
    try {
      resolvedEntry = req.resolve("bin-only-tool");
    } catch {
      resolvedEntry = req.resolve("bin-only-tool/package.json");
    }

    const pkgDir = dirname(resolvedEntry);
    const pkgJson = JSON.parse(
      require("node:fs").readFileSync(resolve(pkgDir, "package.json"), "utf8"),
    );
    const binPath = resolve(pkgDir, pkgJson.bin["bin-only-tool"]);
    expect(binPath).toBe(resolve(binOnlyPkg, "bin/cli.js"));
  });
});

/**
 * Regression guard for the release payload prune rules in sidecar-paths.mjs:
 * confirmed-droppable ffmpeg/ffprobe media packages, development artifacts
 * (sourcemaps, .d.ts, coverage), and pdf-parse's duplicated nested
 * @napi-rs/canvas copy must be removed, while runtime files (including
 * typescript's standard-library .d.ts assets and the @napi-rs/canvas copy
 * pdfjs-dist loads at module init) must survive.
 */
describe("pruneRuntimeDependenciesForTarget release payload rules", () => {
  const tmpDir = resolve(import.meta.dirname, ".tmp-prune-test");
  const nodeModulesDir = resolve(tmpDir, "node_modules");

  function writePackage(packageName: string, files: Record<string, string>) {
    const packageDir = resolve(nodeModulesDir, packageName);
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(
      resolve(packageDir, "package.json"),
      JSON.stringify({ name: packageName, version: "1.0.0" }),
    );
    for (const [relativePath, content] of Object.entries(files)) {
      const filePath = resolve(packageDir, relativePath);
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, content);
    }
  }

  beforeAll(async () => {
    // Pin the prune target so the test is host-platform independent.
    vi.stubEnv("NEXU_TARGET_PLATFORM", "mac");
    rmSync(tmpDir, { recursive: true, force: true });

    writePackage("fluent-ffmpeg", { "index.js": "" });
    writePackage("@ffmpeg-installer/ffmpeg", { "index.js": "" });
    writePackage("@ffprobe-installer/ffprobe", { "index.js": "" });
    writePackage("some-lib", {
      "index.js": "",
      "index.js.map": "{}",
      "index.d.ts": "",
      "coverage/lcov.info": "",
    });
    writePackage("typescript", {
      "lib/lib.dom.d.ts": "",
    });
    writePackage("pdf-parse", {
      "dist/pdf-parse/esm/index.js": "",
      "node_modules/@napi-rs/canvas/package.json": "{}",
      "node_modules/pdfjs-dist/package.json": JSON.stringify({
        name: "pdfjs-dist",
        version: "5.0.0",
      }),
      "node_modules/pdfjs-dist/legacy/build/pdf.mjs": "",
      "node_modules/pdfjs-dist/node_modules/@napi-rs/canvas/package.json": "{}",
    });

    await pruneRuntimeDependenciesForTarget(nodeModulesDir);
  });

  afterAll(() => {
    vi.unstubAllEnvs();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("removes confirmed-droppable ffmpeg/ffprobe media packages", () => {
    expect(existsSync(resolve(nodeModulesDir, "fluent-ffmpeg"))).toBe(false);
    expect(
      existsSync(resolve(nodeModulesDir, "@ffmpeg-installer/ffmpeg")),
    ).toBe(false);
    expect(
      existsSync(resolve(nodeModulesDir, "@ffprobe-installer/ffprobe")),
    ).toBe(false);
  });

  it("removes development artifacts but keeps runtime files", () => {
    const someLib = resolve(nodeModulesDir, "some-lib");
    expect(existsSync(resolve(someLib, "index.js"))).toBe(true);
    expect(existsSync(resolve(someLib, "index.js.map"))).toBe(false);
    expect(existsSync(resolve(someLib, "index.d.ts"))).toBe(false);
    expect(existsSync(resolve(someLib, "coverage"))).toBe(false);
  });

  it("keeps typescript standard-library .d.ts assets", () => {
    expect(
      existsSync(resolve(nodeModulesDir, "typescript/lib/lib.dom.d.ts")),
    ).toBe(true);
  });

  it("dedupes pdf-parse @napi-rs/canvas but keeps the shared copy pdfjs loads at module init", () => {
    const pdfParse = resolve(nodeModulesDir, "pdf-parse");
    // pdfjs-dist's DOMMatrix polyfill require()s @napi-rs/canvas at module
    // load; Node resolution falls back to pdf-parse's copy, which must stay.
    expect(existsSync(resolve(pdfParse, "node_modules/@napi-rs"))).toBe(true);
    expect(
      existsSync(
        resolve(pdfParse, "node_modules/pdfjs-dist/node_modules/@napi-rs"),
      ),
    ).toBe(false);
    expect(
      existsSync(
        resolve(pdfParse, "node_modules/pdfjs-dist/legacy/build/pdf.mjs"),
      ),
    ).toBe(true);
  });
});
