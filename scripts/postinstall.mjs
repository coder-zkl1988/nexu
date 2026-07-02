import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { resolve } from "node:path";

const repoRoot = process.cwd();
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function createCommandSpec(command, args) {
  if (
    process.platform === "win32" &&
    (command === "npm" || command === "npm.cmd")
  ) {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", ["npm", ...args].join(" ")],
    };
  }

  return { command, args };
}

function isTruthy(value) {
  if (!value) {
    return false;
  }

  const normalizedValue = value.trim().toLowerCase();
  return normalizedValue === "1" || normalizedValue === "true";
}

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function run(command, args) {
  await new Promise((resolvePromise, rejectPromise) => {
    const commandSpec = createCommandSpec(command, args);
    const child = spawn(commandSpec.command, commandSpec.args, {
      cwd: repoRoot,
      stdio: "inherit",
      env: process.env,
    });

    child.on("error", rejectPromise);
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      rejectPromise(
        new Error(
          `${command} ${args.join(" ")} exited with code ${code ?? "unknown"}`,
        ),
      );
    });
  });
}

async function installWeixinRuntimePlugin() {
  const pluginRoot = resolve(
    repoRoot,
    "apps/controller/static/runtime-plugins/openclaw-weixin",
  );
  const pluginPackageJsonPath = resolve(pluginRoot, "package.json");

  // Skip if package.json is missing — openclaw-weixin is now bundled at
  // runtime by slimclaw's bundle-runtime-plugins.mjs (from the
  // @tencent-weixin/openclaw-weixin npm package), so the static seed
  // directory no longer needs an npm install step.
  if (!(await pathExists(pluginPackageJsonPath))) {
    console.log(
      "Skipping openclaw-weixin postinstall (no package.json — handled by slimclaw bundle).",
    );
    return;
  }

  const pluginLockfilePath = resolve(pluginRoot, "package-lock.json");

  if (await pathExists(pluginLockfilePath)) {
    await run(npmCommand, [
      "--prefix",
      "./apps/controller/static/runtime-plugins/openclaw-weixin",
      "ci",
      "--omit=dev",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
    ]);
    return;
  }

  await run(npmCommand, [
    "--prefix",
    "./apps/controller/static/runtime-plugins/openclaw-weixin",
    "install",
    "--production",
    "--ignore-scripts",
    "--prefer-offline",
    "--no-audit",
    "--no-fund",
  ]);
}

async function buildDevUtils() {
  await run(process.execPath, [
    resolve(repoRoot, "node_modules", "typescript", "bin", "tsc"),
    "-p",
    "./packages/dev-utils/tsconfig.json",
  ]);
}

async function buildSlimclaw() {
  await run(process.execPath, [
    resolve(repoRoot, "packages", "slimclaw", "build.mjs"),
  ]);
}

async function installElectronBinary() {
  // Electron >=43 removed its bundled `postinstall` script from package.json,
  // so pnpm's `onlyBuiltDependencies` no longer downloads the runtime binary.
  // Run install.js explicitly so the binary and path.txt are present for tests
  // and packaging. This is idempotent — @electron/get caches downloads under
  // ~/.cache/electron — and runs even when NEXU_SKIP_RUNTIME_POSTINSTALL is set,
  // because unit tests (which transitively import electron) and packaging both
  // need the binary regardless of the heavier runtime-prep steps skipped below.
  const electronDir = resolve(repoRoot, "node_modules", "electron");
  const pathTxt = resolve(electronDir, "path.txt");
  if (await pathExists(pathTxt)) {
    return;
  }
  const installScript = resolve(electronDir, "install.js");
  if (!(await pathExists(installScript))) {
    return;
  }
  console.log("Installing Electron binary (electron >=43 has no postinstall)…");
  await run(process.execPath, [installScript]);
}

// Electron binary must be present before any test or build step, so install it
// before the NEXU_SKIP_RUNTIME_POSTINSTALL early-exit (CI sets that flag to
// skip the heavier weixin/slimclaw/dev-utils prep, not the electron binary).
await installElectronBinary();

if (isTruthy(process.env.NEXU_SKIP_RUNTIME_POSTINSTALL)) {
  console.log(
    "Skipping runtime postinstall via NEXU_SKIP_RUNTIME_POSTINSTALL.",
  );
  process.exit(0);
}

await installWeixinRuntimePlugin();
await buildDevUtils();
await buildSlimclaw();
