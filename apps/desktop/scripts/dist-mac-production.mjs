#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const electronRoot = resolve(scriptDir, "..");

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

function capture(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    return e.stdout || "";
  }
}

function notarytoolAuthArgs(env) {
  const apiKeyIssuer = env.APPLE_API_ISSUER;
  const apiKeyId = env.APPLE_API_KEY_ID;
  const apiKeyPath = env.APPLE_API_KEY_PATH || env.APPLE_API_KEY;
  const appleId = env.NEXU_APPLE_ID ?? env.APPLE_ID;
  const appleIdPw =
    env.NEXU_APPLE_APP_SPECIFIC_PASSWORD ?? env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = env.NEXU_APPLE_TEAM_ID ?? env.APPLE_TEAM_ID;

  if (apiKeyIssuer && apiKeyId && apiKeyPath) {
    return ["--issuer", apiKeyIssuer, "--key", apiKeyPath, "--key-id", apiKeyId];
  }
  if (appleId && appleIdPw && teamId) {
    return ["--apple-id", appleId, "--password", appleIdPw, "--team-id", teamId];
  }
  return null;
}

async function findAppBundles(releaseRoot) {
  const entries = await readdir(releaseRoot, { withFileTypes: true }).catch(() => []);
  const dirs = entries.filter(
    (e) => e.isDirectory() && (e.name === "mac" || e.name.startsWith("mac-")),
  );
  return dirs.map((d) => ({
    name: d.name,
    path: resolve(releaseRoot, d.name, "Tabby.app"),
  }));
}

function findMachOFiles(rootPath) {
  const out = execFileSync("bash", ["-c",
    `find "${rootPath}" -type f -print0 2>/dev/null | xargs -0 file --mime-type 2>/dev/null | grep -i "mach" | sed 's/:.*//'`,
  ], { encoding: "utf8" });
  return out.trim().split("\n").filter(Boolean);
}

async function step(label, fn) {
  console.log(`\n>>> [dist:mac:production] ${label}...`);
  try {
    await fn();
    console.log(`    ✅ ${label}`);
  } catch (err) {
    console.log(`    ❌ ${label}: ${err.message}`);
    throw err;
  }
}

async function isDmgNotarized(dmgPath) {
  const out = capture("xcrun", ["stapler", "validate", dmgPath]);
  return out.includes("The validate action worked");
}

async function main() {
  console.log("========================================");
  console.log(" macOS Build + Manual Sign + Notarize");
  console.log("========================================");

  // Load .env
  Object.assign(process.env, await loadDesktopEnv());
  const releaseRoot = process.env.NEXU_DESKTOP_RELEASE_DIR
    ? resolve(process.env.NEXU_DESKTOP_RELEASE_DIR)
    : resolve(electronRoot, "release");
  const signingIdentity = process.env.NEXU_DESKTOP_SIGNING_IDENTITY;
  const authArgs = notarytoolAuthArgs(process.env);

  if (!signingIdentity) {
    throw new Error("NEXU_DESKTOP_SIGNING_IDENTITY not set in .env");
  }
  if (!authArgs) {
    throw new Error("notarization credentials not configured in .env");
  }

  const targetArch = process.env.NEXU_DESKTOP_TARGET_ARCH || process.arch;
  const desktopPkg = JSON.parse(
    await readFile(resolve(electronRoot, "package.json"), "utf8"),
  );
  const version = desktopPkg.version;
  const dmgName = `nexu-${version}-${targetArch}.dmg`;
  const dmgPath = resolve(releaseRoot, dmgName);
  const entitlements = resolve(electronRoot, "build", "entitlements.mac.plist");
  const inheritEntitlements = resolve(
    electronRoot,
    "build",
    "entitlements.mac.inherit.plist",
  );

  // === 1. Build unsigned .app (skip DMG/ZIP via dir target) ===
  await step("1/5 构建 unsigned .app", async () => {
    try {
      await run("node", [resolve(scriptDir, "dist-mac.mjs"), "--unsigned"], {
        cwd: electronRoot,
        env: { ...process.env, NEXU_DESKTOP_MAC_TARGETS: "dir" },
      });
    } catch {
      const apps = await findAppBundles(releaseRoot);
      if (apps.length === 0) throw new Error("unsigned build produced no .app");
      console.log("    ⚠️  build completed with non-fatal warnings, .app found");
    }
  });

  const apps = await findAppBundles(releaseRoot);
  if (apps.length === 0) throw new Error("no .app bundle found after build");
  const appPath = apps[0].path;
  const openclawArchive = resolve(
    appPath, "Contents", "Resources", "runtime", "openclaw", "payload.tar.gz",
  );

  // === 2. Sign native binaries inside openclaw sidecar archive ===
  await step("2/5 签名 sidecar 归档", async () => {
    try {
      await access(openclawArchive);
    } catch {
      console.log("    ⚠️  sidecar archive not found, skipping");
      return;
    }
    const tmpDir = await mkdtemp(resolve(tmpdir(), "openclaw-sign-"));
    try {
      // Extract archive
      await run("tar", ["-xzf", openclawArchive, "-C", tmpDir]);
      // Find and sign Mach-O files inside
      const files = findMachOFiles(tmpDir);
      if (files.length === 0) {
        console.log("    ⚠️  no Mach-O files found in sidecar");
        return;
      }
      for (const [i, f] of files.entries()) {
        console.log(`    [${i + 1}/${files.length}] 签名 ${f.replace(tmpDir, "")}`);
        await run("codesign", [
          "--force", "--sign", signingIdentity,
          "--timestamp", "--options", "runtime",
          "--entitlements", inheritEntitlements, f,
        ]);
      }
      // Repack
      await run("tar", ["-czf", openclawArchive, "-C", tmpDir, "."]);
      console.log(`    signed ${files.length} binaries in sidecar`);
    } finally {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  // === 3. Find and sign ALL Mach-O files in .app, then sign .app ===
  await step("3/5 签名全部 Mach-O 文件", async () => {
    const allMachO = findMachOFiles(appPath);
    console.log(`    found ${allMachO.length} Mach-O files in .app`);

    // Sign each individual Mach-O file with inherit entitlements
    for (const [i, f] of allMachO.entries()) {
      const rel = f.replace(appPath, "").replace(/^\//, "");
      console.log(`    [${i + 1}/${allMachO.length}] 签名 ${rel}`);
      await run("codesign", [
        "--force", "--sign", signingIdentity,
        "--timestamp", "--options", "runtime",
        "--entitlements", inheritEntitlements, f,
      ]);
    }

    // Sign nested bundles (.app helpers, frameworks) then sign .app itself
    await run("codesign", [
      "--deep", "--force", "--sign", signingIdentity,
      "--timestamp", "--options", "runtime",
      "--entitlements", entitlements, appPath,
    ]);
  });

  // Clean old DMGs/zips/blockmaps from release dir before rebuilding
  for (const entry of await readdir(releaseRoot).catch(() => [])) {
    if (/\.(dmg|zip|blockmap)$/iu.test(entry)) {
      await rm(resolve(releaseRoot, entry), { force: true }).catch(() => {});
    }
  }

  // === 4. Create DMG from signed .app (with Applications symlink) ===
  await step("4/5 创建 DMG", async () => {
    const stagingDir = await mkdtemp(resolve(tmpdir(), "dmg-staging-"));
    try {
      const dmgRoot = resolve(stagingDir, "Tabby");
      await mkdir(dmgRoot, { recursive: true });
      // APFS clone of signed .app (instant on same volume via clonefile)
      await run("cp", ["-cR", appPath, resolve(dmgRoot, "Tabby.app")]);
      // Applications symlink for drag-and-drop install
      await run("ln", ["-s", "/Applications", resolve(dmgRoot, "Applications")]);
      await run("hdiutil", [
        "create", "-srcfolder", dmgRoot,
        "-ov", "-format", "ULFO",
        "-volname", "Tabby", dmgPath,
      ]);
    } finally {
      await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  // === 5. Sign + notarize DMG (single upload — Apple generates tickets
  //       for both .dmg and nested .app from this one submission) ===
  await step("5/5 签名 + 公证 DMG", async () => {
    await run("codesign", [
      "--force", "--sign", signingIdentity, "-v", dmgPath,
    ]);
    if (!(await isDmgNotarized(dmgPath))) {
      await run("xcrun", ["notarytool", "submit", dmgPath, ...authArgs, "--wait"]);
      await run("xcrun", ["stapler", "staple", dmgPath]);
    }
  });

  // Strip xattrs (macOS 15+ iCloud provenance fix)
  await run("xattr", ["-cr", appPath]).catch(() => {});
  await run("xattr", ["-cr", dmgPath]).catch(() => {});

  // === Verification ===
  console.log("\n========================================");
  console.log(" 最终验证");
  console.log("========================================");
  console.log(`\n--- ${apps[0].name}/Tabby.app ---`);
  const spctlOut = capture("spctl", ["-a", "-vv", appPath]);
  console.log(spctlOut.split("\n").find((l) => l.includes("accepted")) || spctlOut);

  console.log(`\n--- ${dmgName} ---`);
  const dmgStaple = capture("xcrun", ["stapler", "validate", dmgPath]);
  console.log(dmgStaple.split("\n").find((l) => l.includes("validate")) || dmgStaple);
  const codeSignOut = capture("codesign", ["-dvvv", dmgPath]);
  const authorityLine = codeSignOut.split("\n").find((l) => l.includes("Authority"));
  if (authorityLine) console.log(authorityLine);

  console.log("\n========================================");
  console.log(" ✅ 全部完成！");
  console.log("========================================");
}

await main();
