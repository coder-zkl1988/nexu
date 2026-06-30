import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { repoRootPath } from "@nexu/dev-utils";

import { getToolsDevRuntimeConfig } from "../shared/dev-runtime-config.js";
import { logger as rootLogger } from "../shared/logger.js";

const execFileAsync = promisify(execFile);
const logger = rootLogger.child({ component: "tabby-control-plugin" });

/**
 * Resolve the tabby-control repo directory. It lives outside the Nexu repo as a
 * sibling, and `repoRootPath` is the *worktree* root in dev, so we resolve the
 * main repo via git's common dir and look for tabby-control next to it.
 */
async function resolveTabbyControlDir(): Promise<string | null> {
  if (process.env.TABBY_CONTROL_DIR) {
    return process.env.TABBY_CONTROL_DIR;
  }
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      { cwd: repoRootPath },
    );
    // stdout is "<mainRepo>/.git" for both the main checkout and worktrees.
    const mainRepo = dirname(stdout.trim());
    return join(mainRepo, "..", "tabby-control");
  } catch {
    return null;
  }
}

/**
 * Bundle the tabby-control device-control plugin (which lives in a separate repo)
 * and stage it into the openclaw extensions dir so a fresh worktree has it loaded
 * at openclaw boot — matching how `controller build` bundles it for packaged apps.
 *
 * Best-effort: never blocks dev startup. Skips fast when already staged, and warns
 * (without failing) when the tabby-control source is missing or unbuilt.
 */
export async function ensureTabbyControlPluginStaged(): Promise<void> {
  try {
    const runtimeConfig = getToolsDevRuntimeConfig();
    const extensionsDir = join(runtimeConfig.openclawStateDir, "extensions");
    const stagedPlugin = join(extensionsDir, "tabby-control");

    // Already staged — repeat starts skip the bundle entirely.
    if (existsSync(join(stagedPlugin, "openclaw.plugin.json"))) {
      return;
    }

    const tabbyControlDir = await resolveTabbyControlDir();
    const distNexu = tabbyControlDir
      ? join(tabbyControlDir, "dist-nexu", "tabby-control")
      : null;
    if (!distNexu || !existsSync(join(distNexu, "openclaw.plugin.json"))) {
      logger.warn(
        "tabby-control source not found — device control plugin unavailable in this worktree; " +
          'run "pnpm build:nexu" in the tabby-control repo or set TABBY_CONTROL_DIR',
        { tabbyControlDir },
      );
      return;
    }

    // Run the controller bundle step for just this plugin: it applies the
    // tabby-control runtime patches and writes the deployable to .dist-runtime.
    const bundleScript = join(
      repoRootPath,
      "apps",
      "controller",
      "scripts",
      "bundle-runtime-plugins.mjs",
    );
    await execFileAsync(process.execPath, [bundleScript], {
      cwd: repoRootPath,
      env: {
        ...process.env,
        TABBY_CONTROL_DIR: tabbyControlDir as string,
        BUNDLE_PLUGINS: "tabby-control",
      },
    });

    const bundled = join(
      repoRootPath,
      "apps",
      "controller",
      ".dist-runtime",
      "plugins",
      "tabby-control",
    );
    if (!existsSync(join(bundled, "openclaw.plugin.json"))) {
      logger.warn("tabby-control bundle produced no output — skipping stage");
      return;
    }

    await mkdir(extensionsDir, { recursive: true });
    await cp(bundled, stagedPlugin, { recursive: true, force: true });
    logger.info("staged tabby-control plugin into openclaw extensions", {
      stagedPlugin,
    });
  } catch (error) {
    // Device control is optional — never block the dev stack on it.
    logger.warn("failed to stage tabby-control plugin (continuing)", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
