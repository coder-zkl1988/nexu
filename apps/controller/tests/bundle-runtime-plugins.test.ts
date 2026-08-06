import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  planDependencyPlacements,
  resolveDependencyNodeModules,
} from "../scripts/bundle-runtime-plugins.mjs";

describe("resolveDependencyNodeModules", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempRoots.map((rootDir) => rm(rootDir, { recursive: true, force: true })),
    );
    tempRoots.length = 0;
  });

  it("falls back to the pnpm virtual-store node_modules when the package-local directory only contains .bin", async () => {
    const rootDir = await mkdtemp(
      path.join(tmpdir(), "nexu-bundle-runtime-plugins-"),
    );
    tempRoots.push(rootDir);

    const packageRoot = path.join(
      rootDir,
      "node_modules",
      ".pnpm",
      "@scope+plugin@1.0.0",
      "node_modules",
      "@scope",
      "plugin",
    );
    const packageLocalNodeModules = path.join(packageRoot, "node_modules");
    const virtualStoreNodeModules = path.join(
      rootDir,
      "node_modules",
      ".pnpm",
      "@scope+plugin@1.0.0",
      "node_modules",
    );
    const dependencyDir = path.join(virtualStoreNodeModules, "dingtalk-stream");

    await mkdir(path.join(packageLocalNodeModules, ".bin"), {
      recursive: true,
    });
    await mkdir(dependencyDir, { recursive: true });
    await writeFile(
      path.join(dependencyDir, "package.json"),
      '{ "name": "dingtalk-stream" }\n',
      "utf8",
    );

    expect(resolveDependencyNodeModules(packageRoot)).toBe(
      virtualStoreNodeModules,
    );
  });

  it("prefers the package-local node_modules when it contains real dependencies", async () => {
    const rootDir = await mkdtemp(
      path.join(tmpdir(), "nexu-bundle-runtime-plugins-"),
    );
    tempRoots.push(rootDir);

    const packageRoot = path.join(rootDir, "plugin");
    const packageLocalNodeModules = path.join(packageRoot, "node_modules");
    const dependencyDir = path.join(packageLocalNodeModules, "silk-wasm");

    await mkdir(dependencyDir, { recursive: true });
    await writeFile(
      path.join(dependencyDir, "package.json"),
      '{ "name": "silk-wasm" }\n',
      "utf8",
    );

    expect(resolveDependencyNodeModules(packageRoot)).toBe(
      packageLocalNodeModules,
    );
  });
});

describe("planDependencyPlacements", () => {
  it("keeps a single copy when every consumer wants the same version", () => {
    const placements = planDependencyPlacements([
      {
        name: "zod",
        version: "4.3.6",
        realPath: "/store/zod",
        parentName: null,
      },
      {
        name: "zod",
        version: "4.3.6",
        realPath: "/store/zod",
        parentName: "lark",
      },
    ]);

    expect(placements).toEqual([
      { name: "zod", realPath: "/store/zod", nestUnder: null },
    ]);
  });

  it("nests a conflicting version under the package that requires it", () => {
    // dingtalk-connector pins form-data@4.0.0 while its axios needs ^4.0.5.
    // Both must survive: the pin at top level, axios's copy nested under axios.
    const placements = planDependencyPlacements([
      {
        name: "form-data",
        version: "4.0.0",
        realPath: "/store/form-data@4.0.0",
        parentName: null,
      },
      {
        name: "axios",
        version: "1.14.0",
        realPath: "/store/axios",
        parentName: null,
      },
      {
        name: "form-data",
        version: "4.0.5",
        realPath: "/store/form-data@4.0.5",
        parentName: "axios",
      },
    ]);

    expect(placements).toEqual([
      {
        name: "form-data",
        realPath: "/store/form-data@4.0.0",
        nestUnder: null,
      },
      { name: "axios", realPath: "/store/axios", nestUnder: null },
      {
        name: "form-data",
        realPath: "/store/form-data@4.0.5",
        nestUnder: "axios",
      },
    ]);
  });

  it("drops a conflicting version that has no parent to nest under", () => {
    // Without a parent there is no correct place for it; hoisting it would
    // silently override the top-level copy, which is the bug being fixed.
    const placements = planDependencyPlacements([
      {
        name: "ws",
        version: "8.20.0",
        realPath: "/store/ws@8.20.0",
        parentName: null,
      },
      {
        name: "ws",
        version: "8.21.1",
        realPath: "/store/ws@8.21.1",
        parentName: null,
      },
    ]);

    expect(placements).toEqual([
      { name: "ws", realPath: "/store/ws@8.20.0", nestUnder: null },
    ]);
  });

  it("keeps scoped package names intact", () => {
    const placements = planDependencyPlacements([
      {
        name: "@scope/pkg",
        version: "1.0.0",
        realPath: "/store/scope-pkg",
        parentName: null,
      },
    ]);

    expect(placements).toEqual([
      { name: "@scope/pkg", realPath: "/store/scope-pkg", nestUnder: null },
    ]);
  });
});
