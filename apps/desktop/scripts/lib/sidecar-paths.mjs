import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as platformFilesystem from "../platforms/filesystem-compat.mjs";
import { resolveBuildTargetPlatform } from "../platforms/platform-resolver.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const electronRoot = resolve(scriptDir, "../..");
export const repoRoot =
  process.env.NEXU_WORKSPACE_ROOT ?? resolve(electronRoot, "../..");

const runtimeSidecarRoot =
  process.env.NEXU_DESKTOP_SIDECAR_OUT_DIR ??
  resolve(repoRoot, ".tmp/sidecars");

export function getSidecarRoot(name) {
  return resolve(runtimeSidecarRoot, name);
}

export async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

export async function resetDir(path) {
  await rm(path, { recursive: true, force: true });
  await mkdir(path, { recursive: true });
}

export function shouldCopyRuntimeDependencies() {
  const value = process.env.NEXU_DESKTOP_COPY_RUNTIME_DEPS;
  return value === "1" || value?.toLowerCase() === "true";
}

function resolveRuntimeDependencyTarget() {
  const platform = resolveBuildTargetPlatform({
    env: process.env,
    platform: process.platform,
  });
  const rawArch = process.env.NEXU_DESKTOP_TARGET_ARCH ?? process.arch;
  const arch =
    rawArch === "x64" || rawArch === "arm64" ? rawArch : process.arch;

  return { platform, arch };
}

function isTargetPlatformPackage(packageName, target) {
  const darwinArch = target.arch === "x64" ? "x64" : "arm64";
  const winArch = target.arch === "arm64" ? "arm64" : "x64";

  if (packageName.startsWith("@napi-rs/canvas-")) {
    return target.platform === "mac"
      ? packageName === `@napi-rs/canvas-darwin-${darwinArch}`
      : packageName === `@napi-rs/canvas-win32-${winArch}-msvc`;
  }

  if (packageName.startsWith("@lydell/node-pty-")) {
    return target.platform === "mac"
      ? packageName === `@lydell/node-pty-darwin-${darwinArch}`
      : packageName === `@lydell/node-pty-win32-${winArch}`;
  }

  if (packageName.startsWith("@mariozechner/clipboard-")) {
    if (target.platform !== "mac") {
      return packageName === `@mariozechner/clipboard-win32-${winArch}-msvc`;
    }

    return (
      packageName === `@mariozechner/clipboard-darwin-${darwinArch}` ||
      packageName === "@mariozechner/clipboard-darwin-universal"
    );
  }

  if (packageName.startsWith("sqlite-vec-")) {
    return target.platform === "mac"
      ? packageName === `sqlite-vec-darwin-${darwinArch}`
      : packageName === "sqlite-vec-windows-x64";
  }

  return true;
}

function shouldCopyRuntimeDependencyPackage(packageName, target) {
  return isTargetPlatformPackage(packageName, target);
}

function getTargetPrebuildNames(target) {
  const darwinArch = target.arch === "x64" ? "x64" : "arm64";
  const winArch = target.arch === "arm64" ? "arm64" : "x64";

  return target.platform === "mac"
    ? new Set([`darwin-${darwinArch}`, "darwin-universal"])
    : new Set([`win32-${winArch}`, `win32-${winArch}-msvc`]);
}

async function pruneRuntimeDependencyTree(rootPath, target) {
  let prunedPackageCount = 0;
  let prunedPrebuildCount = 0;
  let prunedPdfAssetCount = 0;
  const targetPrebuildNames = getTargetPrebuildNames(target);

  async function pruneNodeModules(nodeModulesPath) {
    const entries = await readdir(nodeModulesPath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const entryPath = resolve(nodeModulesPath, entry.name);

      if (entry.name.startsWith("@")) {
        const scopedEntries = await readdir(entryPath, { withFileTypes: true });
        for (const scopedEntry of scopedEntries) {
          if (!scopedEntry.isDirectory()) {
            continue;
          }

          const packageName = `${entry.name}/${scopedEntry.name}`;
          const packagePath = resolve(entryPath, scopedEntry.name);
          if (!shouldCopyRuntimeDependencyPackage(packageName, target)) {
            await rm(packagePath, { recursive: true, force: true });
            prunedPackageCount += 1;
            continue;
          }

          await pruneNestedDependencyRoots(packagePath);
        }
        continue;
      }

      if (!shouldCopyRuntimeDependencyPackage(entry.name, target)) {
        await rm(entryPath, { recursive: true, force: true });
        prunedPackageCount += 1;
        continue;
      }

      await pruneNestedDependencyRoots(entryPath);
    }
  }

  async function prunePrebuilds(packagePath) {
    const prebuildsPath = resolve(packagePath, "prebuilds");
    if (!(await pathExists(prebuildsPath))) {
      return;
    }

    const entries = await readdir(prebuildsPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || targetPrebuildNames.has(entry.name)) {
        continue;
      }

      await rm(resolve(prebuildsPath, entry.name), {
        recursive: true,
        force: true,
      });
      prunedPrebuildCount += 1;
    }
  }

  async function prunePdfParserAssets(packagePath) {
    const packageJsonPath = resolve(packagePath, "package.json");
    if (!(await pathExists(packageJsonPath))) {
      return 0;
    }

    const packageJson = await readJson(packageJsonPath);
    if (packageJson.name !== "pdf-parse") {
      return 0;
    }

    let prunedCount = 0;
    const pruneTargets = [
      resolve(packagePath, "bin"),
      resolve(packagePath, "dist", "pdf-parse", "web"),
      resolve(packagePath, "node_modules", "pdfjs-dist", "web"),
      resolve(packagePath, "lib", "pdf.js", "v1.9.426", "web"),
      resolve(packagePath, "lib", "pdf.js", "v1.10.88", "web"),
      resolve(packagePath, "lib", "pdf.js", "v1.10.100", "web"),
      resolve(packagePath, "lib", "pdf.js", "v2.0.550", "web"),
    ];

    for (const pruneTarget of pruneTargets) {
      if (await pathExists(pruneTarget)) {
        await rm(pruneTarget, { recursive: true, force: true });
        prunedCount += 1;
      }
    }

    async function pruneSourceMaps(root) {
      if (!(await pathExists(root))) {
        return;
      }

      const entries = await readdir(root, { withFileTypes: true });
      for (const entry of entries) {
        const entryPath = resolve(root, entry.name);
        if (entry.isDirectory()) {
          await pruneSourceMaps(entryPath);
          continue;
        }

        if (entry.isFile() && entry.name.endsWith(".map")) {
          await rm(entryPath, { force: true });
          prunedCount += 1;
        }
      }
    }

    await pruneSourceMaps(resolve(packagePath, "dist"));
    await pruneSourceMaps(resolve(packagePath, "node_modules", "pdfjs-dist"));
    await pruneSourceMaps(resolve(packagePath, "lib", "pdf.js"));

    return prunedCount;
  }

  async function pruneNestedDependencyRoots(packagePath) {
    await prunePrebuilds(packagePath);
    prunedPdfAssetCount += await prunePdfParserAssets(packagePath);

    const nestedNodeModulesPath = resolve(packagePath, "node_modules");
    if (await pathExists(nestedNodeModulesPath)) {
      await pruneNodeModules(nestedNodeModulesPath);
    }
  }

  if (await pathExists(rootPath)) {
    await pruneNodeModules(rootPath);
  }

  return { prunedPackageCount, prunedPrebuildCount, prunedPdfAssetCount };
}

export async function pruneRuntimeDependenciesForTarget(rootPath) {
  const target = resolveRuntimeDependencyTarget();
  const { prunedPackageCount, prunedPrebuildCount, prunedPdfAssetCount } =
    await pruneRuntimeDependencyTree(rootPath, target);

  console.log(
    `[sidecar-paths] pruned runtime dependencies root=${rootPath} target=${target.platform}/${target.arch} packages=${prunedPackageCount} prebuilds=${prunedPrebuildCount} pdfAssets=${prunedPdfAssetCount}`,
  );
}

function formatDurationMs(durationMs) {
  return `${(durationMs / 1000).toFixed(3)}s`;
}

export async function linkOrCopyDirectory(
  sourcePath,
  targetPath,
  options = {},
) {
  const excludeNames = new Set(options.excludeNames ?? []);

  if (shouldCopyRuntimeDependencies()) {
    await copyDirectoryTree(sourcePath, targetPath, {
      filter: ({ sourcePath: candidateSourcePath }) => {
        const name = basename(candidateSourcePath);
        return name !== ".bin" && !excludeNames.has(name);
      },
    });
    return;
  }

  if (excludeNames.size === 0) {
    try {
      await symlink(
        sourcePath,
        targetPath,
        platformFilesystem.resolveDirectoryLinkKind({
          env: process.env,
          platform: process.platform,
        }),
      );
    } catch (error) {
      if (
        !platformFilesystem.shouldRetryLinkFailureWithCopy({
          env: process.env,
          platform: process.platform,
        })
      ) {
        throw error;
      }

      await cp(sourcePath, targetPath, {
        recursive: true,
        dereference: true,
        filter: (source) => basename(source) !== ".bin",
      });
    }
    return;
  }

  await mkdir(targetPath, { recursive: true });
  const entries = await readdir(sourcePath);

  for (const entry of entries) {
    if (entry === ".bin" || excludeNames.has(entry)) {
      continue;
    }

    const sourceEntryPath = resolve(sourcePath, entry);
    const sourceEntryStats = await lstat(sourceEntryPath);

    const targetEntryPath = resolve(targetPath, entry);

    try {
      await symlink(
        sourceEntryPath,
        targetEntryPath,
        platformFilesystem.resolveEntryLinkKind({
          env: process.env,
          platform: process.platform,
          isDirectory: sourceEntryStats.isDirectory(),
        }),
      );
    } catch (error) {
      if (
        !platformFilesystem.shouldRetryLinkFailureWithCopy({
          env: process.env,
          platform: process.platform,
        })
      ) {
        throw error;
      }

      await cp(sourceEntryPath, targetEntryPath, {
        recursive: sourceEntryStats.isDirectory(),
        dereference: true,
      });
    }
  }
}

export async function copyDirectoryTree(sourcePath, targetPath, options = {}) {
  const sourceStats = await lstat(sourcePath);
  const relativePath = options.baseSourcePath
    ? relative(options.baseSourcePath, sourcePath)
    : "";

  if (
    options.filter &&
    !options.filter({
      sourcePath,
      targetPath,
      relativePath,
      sourceStats,
    })
  ) {
    return;
  }

  if (sourceStats.isSymbolicLink()) {
    return;
  }

  if (sourceStats.isDirectory()) {
    await mkdir(targetPath, { recursive: true });
    const entries = await readdir(sourcePath);

    for (const entry of entries) {
      await copyDirectoryTree(
        resolve(sourcePath, entry),
        resolve(targetPath, entry),
        {
          ...options,
          baseSourcePath: options.baseSourcePath ?? sourcePath,
        },
      );
    }
    return;
  }

  await mkdir(dirname(targetPath), { recursive: true });
  await cp(sourcePath, targetPath, { force: true });
}

export async function removePathIfExists(path) {
  await rm(path, { recursive: true, force: true });
}

function getPackagePathParts(packageName) {
  return packageName.startsWith("@") ? packageName.split("/") : [packageName];
}

function getRootPackageName(packageName) {
  const packagePathParts = getPackagePathParts(packageName);
  return packagePathParts.length === 1
    ? packagePathParts[0]
    : `${packagePathParts[0]}/${packagePathParts[1]}`;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function resolveInstalledPackageRoot(packageRoot, packageName) {
  const requireFromPackage = createRequire(
    resolve(packageRoot, "package.json"),
  );
  let resolvedEntryPath;
  try {
    resolvedEntryPath = requireFromPackage.resolve(packageName);
  } catch {
    resolvedEntryPath = requireFromPackage.resolve(
      `${packageName}/package.json`,
    );
  }
  const rootPackageName = getRootPackageName(packageName);

  let currentPath = dirname(resolvedEntryPath);
  while (currentPath !== dirname(currentPath)) {
    const packageJsonPath = resolve(currentPath, "package.json");
    if (await pathExists(packageJsonPath)) {
      const packageJson = await readJson(packageJsonPath);
      if (packageJson.name === rootPackageName) {
        return realpath(currentPath);
      }
    }
    currentPath = dirname(currentPath);
  }

  throw new Error(
    `Unable to locate package root for ${packageName} from ${packageRoot}.`,
  );
}

export async function copyRuntimeDependencyClosure({
  packageRoot,
  targetNodeModules,
  dependencyNames,
  onPackageCopied,
}) {
  const closureStartedAt = performance.now();
  let copiedPackageCount = 0;
  await mkdir(targetNodeModules, { recursive: true });

  const rootPackageJson = await readJson(resolve(packageRoot, "package.json"));
  const seen = new Set();
  const dependencyTarget = resolveRuntimeDependencyTarget();
  let skippedPackageCount = 0;

  async function copyDependencyTree({
    dependencyName,
    resolutionBaseRoot,
    destinationNodeModules,
  }) {
    if (!shouldCopyRuntimeDependencyPackage(dependencyName, dependencyTarget)) {
      skippedPackageCount += 1;
      return;
    }

    const packagePathParts = getPackagePathParts(dependencyName);
    let sourcePackageRoot;
    try {
      sourcePackageRoot = await resolveInstalledPackageRoot(
        resolutionBaseRoot,
        dependencyName,
      );
    } catch {
      return;
    }

    const targetPackageRoot = resolve(
      destinationNodeModules,
      ...packagePathParts,
    );
    const seenKey = `${sourcePackageRoot}:${targetPackageRoot}`;
    if (seen.has(seenKey)) {
      return;
    }
    seen.add(seenKey);
    copiedPackageCount += 1;
    onPackageCopied?.(copiedPackageCount);

    await mkdir(dirname(targetPackageRoot), { recursive: true });
    await rm(targetPackageRoot, { recursive: true, force: true });
    await copyDirectoryTree(sourcePackageRoot, targetPackageRoot, {
      filter: ({
        sourcePath: candidateSourcePath,
        relativePath: candidateRelativePath,
      }) => {
        if (basename(candidateSourcePath) === ".bin") {
          return false;
        }

        return (
          candidateRelativePath === "" ||
          (!candidateRelativePath.startsWith("node_modules/") &&
            candidateRelativePath !== "node_modules")
        );
      },
    });

    const packageJsonPath = resolve(sourcePackageRoot, "package.json");
    if (!(await pathExists(packageJsonPath))) {
      return;
    }

    const packageJson = await readJson(packageJsonPath);
    const childDependencyNames = [
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.optionalDependencies ?? {}),
    ];

    for (const childDependencyName of childDependencyNames) {
      await copyDependencyTree({
        dependencyName: childDependencyName,
        resolutionBaseRoot: sourcePackageRoot,
        destinationNodeModules: resolve(targetPackageRoot, "node_modules"),
      });
    }
  }

  const rootDependencyNames = [
    ...(dependencyNames ?? Object.keys(rootPackageJson.dependencies ?? {})),
    ...Object.keys(rootPackageJson.optionalDependencies ?? {}),
  ];

  for (const dependencyName of rootDependencyNames) {
    await copyDependencyTree({
      dependencyName,
      resolutionBaseRoot: packageRoot,
      destinationNodeModules: targetNodeModules,
    });
  }

  await pruneRuntimeDependenciesForTarget(targetNodeModules);

  console.log(
    `[sidecar-paths][timing] copyRuntimeDependencyClosure packageRoot=${packageRoot} target=${dependencyTarget.platform}/${dependencyTarget.arch} packages=${copiedPackageCount} skipped=${skippedPackageCount} duration=${formatDurationMs(
      performance.now() - closureStartedAt,
    )}`,
  );
}
