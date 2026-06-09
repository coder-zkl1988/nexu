#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const electronRoot = resolve(scriptDir, "..");
const repoRoot = process.env.NEXU_WORKSPACE_ROOT
  ? resolve(process.env.NEXU_WORKSPACE_ROOT)
  : resolve(electronRoot, "../..");
const productName = "Tabby";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`Usage:
  pnpm dist:mac:production:arm64
  pnpm --filter @nexu/desktop dist:mac:production:arm64

Environment:
  NEXU_DESKTOP_SIGNING_IDENTITY or CSC_NAME
  NEXU_APPLE_NOTARY_PROFILE or APPLE_NOTARY_PROFILE
  NEXU_DESKTOP_UPDATE_CHANNEL=stable
  NEXU_NOTARY_TIMEOUT=30m
  NEXU_NOTARY_NO_S3_ACCELERATION=1
`);
  process.exit(0);
}

function parseEnvFile(content) {
  const values = {};
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const sep = line.indexOf("=");
    if (sep <= 0) continue;
    const key = line.slice(0, sep).trim();
    let value = line.slice(sep + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

async function loadDesktopEnv() {
  try {
    const content = await readFile(resolve(electronRoot, ".env"), "utf8");
    return parseEnvFile(content);
  } catch {
    return {};
  }
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? electronRoot,
      env: options.env ?? process.env,
      stdio: "inherit",
    });
    child.once("error", rejectRun);
    child.once("exit", (code) => {
      code === 0 ? resolveRun() : rejectRun(new Error(`exit code ${code}`));
    });
  });
}

function capture(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      cwd: options.cwd ?? electronRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    return `${err.stdout ?? ""}${err.stderr ?? ""}`;
  }
}

function getGitValue(args) {
  const out = capture("git", args, { cwd: repoRoot });
  return out.trim() || null;
}

function resolveSigningIdentity(rawIdentity) {
  const identities = capture("security", [
    "find-identity",
    "-v",
    "-p",
    "codesigning",
  ])
    .split(/\r?\n/u)
    .map((line) => {
      const match = line.match(/^\s*\d+\)\s+([A-F0-9]+)\s+"([^"]+)"/u);
      return match ? { hash: match[1], name: match[2], line } : null;
    })
    .filter(Boolean);

  const developerIdMatches = identities.filter(
    (identity) =>
      identity.name.startsWith("Developer ID Application:") &&
      (identity.hash === rawIdentity || identity.name.includes(rawIdentity)),
  );
  if (developerIdMatches.length === 1) {
    return developerIdMatches[0].name;
  }
  if (developerIdMatches.length > 1) {
    throw new Error(
      `Signing identity ${rawIdentity} matched multiple Developer ID Application certificates:\n${developerIdMatches
        .map((identity) => `  ${identity.line}`)
        .join("\n")}`,
    );
  }

  const exactMatches = identities.filter(
    (identity) =>
      identity.hash === rawIdentity || identity.name === rawIdentity,
  );
  if (exactMatches.length === 1) {
    return exactMatches[0].name;
  }

  return rawIdentity;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function notarytoolAuthArgs(env) {
  const keychainProfile =
    env.NEXU_APPLE_NOTARY_PROFILE ?? env.APPLE_NOTARY_PROFILE;
  const apiKeyIssuer = env.NEXU_APPLE_API_ISSUER ?? env.APPLE_API_ISSUER;
  const apiKeyId = env.NEXU_APPLE_API_KEY_ID ?? env.APPLE_API_KEY_ID;
  const apiKeyPath =
    env.NEXU_APPLE_API_KEY_PATH ?? env.APPLE_API_KEY_PATH ?? env.APPLE_API_KEY;
  const appleId = env.NEXU_APPLE_ID ?? env.APPLE_ID;
  const appleIdPw =
    env.NEXU_APPLE_APP_SPECIFIC_PASSWORD ?? env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = env.NEXU_APPLE_TEAM_ID ?? env.APPLE_TEAM_ID;

  if (keychainProfile) {
    return ["--keychain-profile", keychainProfile];
  }
  if (apiKeyIssuer && apiKeyId && apiKeyPath) {
    return [
      "--issuer",
      apiKeyIssuer,
      "--key",
      apiKeyPath,
      "--key-id",
      apiKeyId,
    ];
  }
  if (appleId && appleIdPw && teamId) {
    return [
      "--apple-id",
      appleId,
      "--password",
      appleIdPw,
      "--team-id",
      teamId,
    ];
  }
  return null;
}

function getNotarySubmitArgs(dmgPath, authArgs, env) {
  const args = ["notarytool", "submit", dmgPath, ...authArgs, "--wait"];
  if (env.NEXU_NOTARY_TIMEOUT) {
    args.push("--timeout", env.NEXU_NOTARY_TIMEOUT);
  }
  if (env.NEXU_NOTARY_NO_S3_ACCELERATION === "1") {
    args.push("--no-s3-acceleration");
  }
  return args;
}

async function findAppBundles(releaseRoot) {
  const entries = await readdir(releaseRoot, { withFileTypes: true }).catch(
    () => [],
  );
  const dirs = entries.filter(
    (e) => e.isDirectory() && (e.name === "mac" || e.name.startsWith("mac-")),
  );
  return dirs.map((d) => ({
    name: d.name,
    path: resolve(releaseRoot, d.name, `${productName}.app`),
  }));
}

function findMachOFiles(rootPath) {
  const out = capture("bash", [
    "-c",
    [
      `find ${shellQuote(rootPath)} -type f \\( -name '*.node' -o -name '*.dylib' -o -name '*.so' -o -name '*.a' -o -perm -111 \\) -print0 2>/dev/null |`,
      'while IFS= read -r -d "" file_path; do',
      '  file_desc="$(file -b "$file_path" 2>/dev/null || true)"',
      '  case "$file_desc" in',
      '    *"Mach-O"*) printf "%s\\n" "$file_path" ;;',
      "  esac",
      "done",
    ].join("\n"),
  ]);
  return out.trim().split("\n").filter(Boolean);
}

function findCodeSignBundles(rootPath) {
  const out = capture("bash", [
    "-c",
    [
      `find ${shellQuote(rootPath)} -type d \\( -name '*.app' -o -name '*.framework' -o -name '*.xpc' -o -name '*.appex' \\) -print 2>/dev/null`,
    ].join("\n"),
  ]);
  return out
    .trim()
    .split("\n")
    .filter((targetPath) => targetPath && targetPath !== rootPath);
}

function sortCodeSignTargets(filePaths) {
  return [...filePaths].sort((a, b) => {
    const depthDiff = b.split("/").length - a.split("/").length;
    if (depthDiff !== 0) return depthDiff;
    return a.localeCompare(b);
  });
}

async function step(label, fn) {
  console.log(`\n>>> [dist:mac:production] ${label}...`);
  try {
    await fn();
    console.log(`    done: ${label}`);
  } catch (err) {
    console.log(`    failed: ${label}: ${err.message}`);
    throw err;
  }
}

async function isDmgNotarized(dmgPath) {
  const out = capture("xcrun", ["stapler", "validate", dmgPath]);
  return out.includes("The validate action worked");
}

async function cleanOldReleaseMetadata(releaseRoot) {
  for (const entry of await readdir(releaseRoot).catch(() => [])) {
    if (
      /^(latest-mac\.yml)$/iu.test(entry) ||
      /\.(dmg|zip|blockmap)$/iu.test(entry)
    ) {
      await rm(resolve(releaseRoot, entry), { force: true }).catch(() => {});
    }
  }
}

async function writeLatestMacYml({ releaseRoot, dmgPath, version }) {
  const bytes = await readFile(dmgPath);
  const fileStat = await stat(dmgPath);
  const sha512 = createHash("sha512").update(bytes).digest("base64");
  const dmgName = basename(dmgPath);
  const latestMacYml = [
    `version: ${version}`,
    "files:",
    `  - url: ${dmgName}`,
    `    sha512: ${sha512}`,
    `    size: ${fileStat.size}`,
    `path: ${dmgName}`,
    `sha512: ${sha512}`,
    `releaseDate: '${new Date().toISOString()}'`,
    "",
  ].join("\n");
  await writeFile(resolve(releaseRoot, "latest-mac.yml"), latestMacYml);
}

async function copyAppBundleForDmg(appPath, dmgRoot) {
  const targetPath = resolve(dmgRoot, `${productName}.app`);
  try {
    await run("cp", ["-cR", appPath, targetPath]);
  } catch {
    await run("cp", ["-R", appPath, targetPath]);
  }
}

async function main() {
  console.log("========================================");
  console.log(" Tabby macOS Production Build");
  console.log(" unsigned dir -> manual sign -> DMG -> notarize");
  console.log("========================================");

  Object.assign(process.env, await loadDesktopEnv());
  const releaseRoot = process.env.NEXU_DESKTOP_RELEASE_DIR
    ? resolve(process.env.NEXU_DESKTOP_RELEASE_DIR)
    : resolve(electronRoot, "release");
  const signingIdentity =
    process.env.NEXU_DESKTOP_SIGNING_IDENTITY ?? process.env.CSC_NAME;
  const authArgs = notarytoolAuthArgs(process.env);

  if (!signingIdentity) {
    throw new Error(
      "NEXU_DESKTOP_SIGNING_IDENTITY or CSC_NAME is required for production signing.",
    );
  }
  const resolvedSigningIdentity = resolveSigningIdentity(signingIdentity);
  if (!authArgs) {
    throw new Error(
      "Apple notarization credentials are required. Set NEXU_APPLE_NOTARY_PROFILE/APPLE_NOTARY_PROFILE, Apple API key envs, or Apple ID credentials.",
    );
  }
  console.log(`Signing identity: ${resolvedSigningIdentity}`);

  const targetArch = process.env.NEXU_DESKTOP_TARGET_ARCH || process.arch;
  if (!["arm64", "x64"].includes(targetArch)) {
    throw new Error(`Unsupported NEXU_DESKTOP_TARGET_ARCH: ${targetArch}`);
  }
  const buildSource = "stable";

  const desktopPkg = JSON.parse(
    await readFile(resolve(electronRoot, "package.json"), "utf8"),
  );
  const version = desktopPkg.version;
  const branch = getGitValue(["branch", "--show-current"]);
  const releaseVersion = branch?.match(/^release\/v(.+)$/u)?.[1];
  if (releaseVersion && releaseVersion !== version) {
    throw new Error(
      `desktop package version ${version} does not match release branch ${branch}. Expected ${releaseVersion}.`,
    );
  }
  const artifactBaseName = `tabby-${version}-${targetArch}`;
  const dmgPath = resolve(releaseRoot, `${artifactBaseName}.dmg`);
  const entitlements = resolve(electronRoot, "build", "entitlements.mac.plist");
  const inheritEntitlements = resolve(
    electronRoot,
    "build",
    "entitlements.mac.inherit.plist",
  );

  await step("1/7 构建 production unsigned .app", async () => {
    try {
      await run("node", [resolve(scriptDir, "dist-mac.mjs"), "--unsigned"], {
        cwd: electronRoot,
        env: {
          ...process.env,
          NEXU_DESKTOP_BUILD_SOURCE: buildSource,
          NEXU_DESKTOP_UPDATE_CHANNEL:
            process.env.NEXU_DESKTOP_UPDATE_CHANNEL ?? "stable",
          NEXU_DESKTOP_MAC_TARGETS: "dir",
          NEXU_DESKTOP_TARGET_ARCH: targetArch,
        },
      });
    } catch {
      const apps = await findAppBundles(releaseRoot);
      if (apps.length === 0) throw new Error("unsigned build produced no .app");
      console.log("    build exited non-zero, but .app exists; continuing");
    }
  });

  const apps = await findAppBundles(releaseRoot);
  if (apps.length === 0) throw new Error("no .app bundle found after build");
  const appPath = apps[0].path;
  const openclawArchive = resolve(
    appPath,
    "Contents",
    "Resources",
    "runtime",
    "openclaw",
    "payload.tar.gz",
  );

  await step("2/7 签名 OpenClaw sidecar 归档内原生二进制", async () => {
    try {
      await access(openclawArchive);
    } catch {
      console.log("    sidecar archive not found, skipped");
      return;
    }

    const tmpDir = await mkdtemp(resolve(tmpdir(), "tabby-openclaw-sign-"));
    try {
      await run("tar", ["-xzf", openclawArchive, "-C", tmpDir]);
      const files = findMachOFiles(tmpDir);
      if (files.length === 0) {
        console.log("    no Mach-O files found in sidecar archive");
        return;
      }

      for (const [i, filePath] of files.entries()) {
        console.log(
          `    [${i + 1}/${files.length}] ${filePath.replace(tmpDir, "")}`,
        );
        await run("codesign", [
          "--force",
          "--sign",
          resolvedSigningIdentity,
          "--timestamp",
          "--options",
          "runtime",
          "--entitlements",
          inheritEntitlements,
          filePath,
        ]);
      }

      await copyFile(openclawArchive, `${openclawArchive}.unsigned-backup`);
      await run("tar", ["-czf", openclawArchive, "-C", tmpDir, "."]);
      await rm(`${openclawArchive}.unsigned-backup`, { force: true }).catch(
        () => {},
      );
    } finally {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  await step("3/7 签名 .app 内全部 Mach-O 文件和应用包", async () => {
    const rootExecutable = resolve(appPath, "Contents", "MacOS", productName);
    const allMachO = sortCodeSignTargets(
      findMachOFiles(appPath).filter((filePath) => filePath !== rootExecutable),
    );
    const codeBundles = sortCodeSignTargets(findCodeSignBundles(appPath));
    console.log(`    found ${allMachO.length} Mach-O files in .app`);

    for (const [i, filePath] of allMachO.entries()) {
      const rel = filePath.replace(appPath, "").replace(/^\//u, "");
      console.log(`    [${i + 1}/${allMachO.length}] ${rel}`);
      await run("codesign", [
        "--force",
        "--sign",
        resolvedSigningIdentity,
        "--timestamp",
        "--options",
        "runtime",
        "--entitlements",
        inheritEntitlements,
        filePath,
      ]);
    }

    console.log(`    found ${codeBundles.length} code bundle(s) in .app`);
    for (const [i, bundlePath] of codeBundles.entries()) {
      const rel = bundlePath.replace(appPath, "").replace(/^\//u, "");
      console.log(`    bundle [${i + 1}/${codeBundles.length}] ${rel}`);
      await run("codesign", [
        "--force",
        "--sign",
        resolvedSigningIdentity,
        "--timestamp",
        "--options",
        "runtime",
        "--entitlements",
        inheritEntitlements,
        bundlePath,
      ]);
    }

    await run("codesign", [
      "--deep",
      "--force",
      "--sign",
      resolvedSigningIdentity,
      "--timestamp",
      "--options",
      "runtime",
      "--entitlements",
      entitlements,
      appPath,
    ]);
  });

  await step("4/7 清理旧发布包并创建 DMG", async () => {
    await mkdir(releaseRoot, { recursive: true });
    await cleanOldReleaseMetadata(releaseRoot);

    const stagingDir = await mkdtemp(resolve(tmpdir(), "tabby-dmg-staging-"));
    try {
      const dmgRoot = resolve(stagingDir, productName);
      await mkdir(dmgRoot, { recursive: true });
      await copyAppBundleForDmg(appPath, dmgRoot);
      await symlink("/Applications", resolve(dmgRoot, "Applications"));
      await run("hdiutil", [
        "create",
        "-srcfolder",
        dmgRoot,
        "-ov",
        "-format",
        "ULFO",
        "-volname",
        productName,
        dmgPath,
      ]);
    } finally {
      await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  await step("5/7 签名并公证 DMG", async () => {
    await run("codesign", [
      "--force",
      "--sign",
      resolvedSigningIdentity,
      "-v",
      dmgPath,
    ]);
    if (!(await isDmgNotarized(dmgPath))) {
      await run("xcrun", getNotarySubmitArgs(dmgPath, authArgs, process.env));
      await run("xcrun", ["stapler", "staple", dmgPath]);
    }
  });

  await step("6/7 生成 GitHub Release 更新元数据", async () => {
    await writeLatestMacYml({ releaseRoot, dmgPath, version });
  });

  await step("7/7 最终验证", async () => {
    await run("codesign", [
      "--verify",
      "--deep",
      "--strict",
      "--verbose=2",
      appPath,
    ]);
    await run("xcrun", ["stapler", "validate", dmgPath]);
    const appAssess = capture("spctl", [
      "-a",
      "-vv",
      "--type",
      "exec",
      appPath,
    ]);
    const dmgAssess = capture("spctl", [
      "--assess",
      "--type",
      "open",
      "--context",
      "context:primary-signature",
      "--verbose=4",
      dmgPath,
    ]);
    console.log(appAssess.trim());
    console.log(dmgAssess.trim());
  });

  await run("xattr", ["-cr", appPath]).catch(() => {});
  await run("xattr", ["-cr", dmgPath]).catch(() => {});

  console.log("\n========================================");
  console.log(" Tabby macOS production artifact ready");
  console.log("========================================");
  console.log(`DMG: ${dmgPath}`);
  console.log(`Update metadata: ${resolve(releaseRoot, "latest-mac.yml")}`);
  console.log(`Repo root: ${repoRoot}`);
}

await main();
