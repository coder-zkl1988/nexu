import { existsSync } from "node:fs";
import {
  access,
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import path, { basename } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ControllerEnv } from "../app/env.js";
import { logger } from "../lib/logger.js";

const BUNDLED_PLUGIN_IDS = new Set([
  "dingtalk-connector",
  "openclaw-lark",
  "openclaw-weixin",
  "openclaw-qqbot",
  "tabby-control",
  "wecom",
  "whatsapp",
]);

interface BundledPluginInstall {
  pluginId: string;
  packageName: string;
  rootDir: string;
  version?: string;
}

export class OpenClawRuntimePluginWriter {
  constructor(private readonly env: ControllerEnv) {}

  async ensurePlugins(): Promise<void> {
    await mkdir(this.env.openclawExtensionsDir, { recursive: true });
    const handledPluginIds = await this.ensureBundledPlugins();
    await this.migrateShadowedManagedNpmInstalls(handledPluginIds);

    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(this.env.runtimePluginTemplatesDir, {
        withFileTypes: true,
      });
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw err;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || handledPluginIds.has(entry.name)) {
        continue;
      }

      const builtinPluginDir = this.env.openclawBuiltinExtensionsDir
        ? path.join(this.env.openclawBuiltinExtensionsDir, entry.name)
        : null;
      const targetDir = path.join(this.env.openclawExtensionsDir, entry.name);
      if (builtinPluginDir && (await this.exists(builtinPluginDir))) {
        await rm(targetDir, { recursive: true, force: true });
        continue;
      }

      const sourceDir = path.join(
        this.env.runtimePluginTemplatesDir,
        entry.name,
      );
      await cp(sourceDir, targetDir, {
        recursive: true,
        force: true,
        dereference: true,
        filter: (source) => basename(source) !== ".bin",
      });
    }
  }

  private async ensureBundledPlugins(): Promise<Set<string>> {
    const handledPluginIds = new Set<string>();

    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(this.env.bundledRuntimePluginsDir, {
        withFileTypes: true,
      });
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return handledPluginIds;
      }
      throw err;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || !BUNDLED_PLUGIN_IDS.has(entry.name)) {
        continue;
      }

      const builtinPluginDir = this.env.openclawBuiltinExtensionsDir
        ? path.join(this.env.openclawBuiltinExtensionsDir, entry.name)
        : null;
      const targetDir = path.join(this.env.openclawExtensionsDir, entry.name);
      if (builtinPluginDir && (await this.exists(builtinPluginDir))) {
        await rm(targetDir, { recursive: true, force: true });
        handledPluginIds.add(entry.name);
        continue;
      }

      const sourceDir = path.join(
        this.env.bundledRuntimePluginsDir,
        entry.name,
      );
      await rm(targetDir, { recursive: true, force: true });
      await cp(sourceDir, targetDir, {
        recursive: true,
        force: true,
        dereference: true,
        filter: (source) => basename(source) !== ".bin",
      });

      // Patch tabby-control plugin (SCREENSHOT_DIR + screenshot pruning).
      if (entry.name === "tabby-control") {
        await this.patchTabbyControlPlugin(targetDir);
      }

      handledPluginIds.add(entry.name);
    }

    return handledPluginIds;
  }

  private async readBundledPluginInstalls(
    handledPluginIds: ReadonlySet<string>,
  ): Promise<BundledPluginInstall[]> {
    const installs: BundledPluginInstall[] = [];
    for (const pluginId of handledPluginIds) {
      const roots = [
        path.join(this.env.openclawExtensionsDir, pluginId),
        ...(this.env.openclawBuiltinExtensionsDir
          ? [path.join(this.env.openclawBuiltinExtensionsDir, pluginId)]
          : []),
      ];
      for (const root of roots) {
        try {
          const parsed: unknown = JSON.parse(
            await readFile(path.join(root, "package.json"), "utf8"),
          );
          if (
            typeof parsed === "object" &&
            parsed !== null &&
            "name" in parsed &&
            typeof parsed.name === "string"
          ) {
            installs.push({
              pluginId,
              packageName: parsed.name,
              rootDir: root,
              ...("version" in parsed && typeof parsed.version === "string"
                ? { version: parsed.version }
                : {}),
            });
            break;
          }
        } catch {
          // Try the next materialized source for this plugin.
        }
      }
    }

    return installs;
  }

  private migratePersistedPluginInstallRecords(
    installs: readonly BundledPluginInstall[],
  ): boolean {
    const databasePath = path.join(
      this.env.openclawStateDir,
      "state",
      "openclaw.sqlite",
    );
    if (!existsSync(databasePath)) {
      return true;
    }
    let database: DatabaseSync;
    try {
      database = new DatabaseSync(databasePath, {
        open: true,
        timeout: 2_000,
      });
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return true;
      }
      logger.warn(
        { error: err instanceof Error ? err.message : String(err) },
        "bundled_plugin_install_record_migration_open_failed",
      );
      return false;
    }

    try {
      const table = database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'installed_plugin_index'",
        )
        .get();
      if (!table) {
        return true;
      }

      const row = database
        .prepare(
          "SELECT install_records_json FROM installed_plugin_index WHERE index_key = ?",
        )
        .get("installed-plugin-index") as
        | { install_records_json?: unknown }
        | undefined;
      if (!row || typeof row.install_records_json !== "string") {
        return true;
      }

      const parsed: unknown = JSON.parse(row.install_records_json);
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        return false;
      }
      const records = parsed as Record<string, unknown>;
      let changed = false;
      for (const install of installs) {
        const current = records[install.pluginId];
        if (
          typeof current !== "object" ||
          current === null ||
          !("source" in current) ||
          current.source === "path"
        ) {
          continue;
        }
        if (
          !("installPath" in current) ||
          typeof current.installPath !== "string" ||
          !current.installPath.includes(
            `${path.sep}npm${path.sep}projects${path.sep}`,
          )
        ) {
          continue;
        }

        records[install.pluginId] = {
          source: "path",
          sourcePath: install.rootDir,
          installPath: install.rootDir,
          ...(install.version ? { version: install.version } : {}),
        };
        changed = true;
      }

      if (changed) {
        database
          .prepare(
            "UPDATE installed_plugin_index SET install_records_json = ?, updated_at_ms = ? WHERE index_key = ?",
          )
          .run(JSON.stringify(records), Date.now(), "installed-plugin-index");
        logger.info(
          { pluginIds: installs.map((install) => install.pluginId) },
          "bundled_plugin_install_records_migrated",
        );
      }
      return true;
    } catch (err: unknown) {
      logger.warn(
        { error: err instanceof Error ? err.message : String(err) },
        "bundled_plugin_install_record_migration_failed",
      );
      return false;
    } finally {
      database.close();
    }
  }

  private async migrateShadowedManagedNpmInstalls(
    handledPluginIds: ReadonlySet<string>,
  ): Promise<void> {
    const installs = await this.readBundledPluginInstalls(handledPluginIds);
    const bundledPackageNames = new Set(
      installs.map((install) => install.packageName),
    );

    if (bundledPackageNames.size === 0) {
      return;
    }

    // OpenClaw's shipped-install migration keeps existing records. Replace
    // stale npm records first so deleting the shadow copy cannot trigger an
    // automatic reinstall on the next gateway boot.
    if (!this.migratePersistedPluginInstallRecords(installs)) {
      return;
    }

    const projectsDir = path.join(this.env.openclawStateDir, "npm", "projects");
    let projects: import("node:fs").Dirent[];
    try {
      projects = await readdir(projectsDir, { withFileTypes: true });
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw err;
    }

    for (const project of projects) {
      if (!project.isDirectory()) {
        continue;
      }
      const projectDir = path.join(projectsDir, project.name);
      try {
        const parsed: unknown = JSON.parse(
          await readFile(path.join(projectDir, "package.json"), "utf8"),
        );
        if (
          typeof parsed !== "object" ||
          parsed === null ||
          !("dependencies" in parsed) ||
          typeof parsed.dependencies !== "object" ||
          parsed.dependencies === null
        ) {
          continue;
        }
        const shadowsBundledPlugin = Object.keys(parsed.dependencies).some(
          (packageName) => bundledPackageNames.has(packageName),
        );
        if (shadowsBundledPlugin) {
          await rm(projectDir, { recursive: true, force: true });
        }
      } catch {
        // Leave malformed or unrelated projects for OpenClaw diagnostics.
      }
    }
  }

  private async exists(targetPath: string): Promise<boolean> {
    try {
      await access(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Patch tabby-control's task-coordinator.js:
   * 1. Make SCREENSHOT_DIR honour OPENCLAW_STATE_DIR instead of hard-coding
   *    `~/.openclaw/media/…`.
   * 2. Add screenshot pruning that deletes .webp files modified before today.
   *
   * When the controller runs with OPENCLAW_STATE_DIR set (dev mode,
   * packaged desktop), the image tool's localRoots only include
   * `<stateDir>/media/`.  The upstream tabby-control writes to
   * `~/.openclaw/media/tabby-screenshots/`, which falls outside that
   * allowlist and causes "path-not-allowed" errors.
   *
   * This is a runtime patch applied after copying the bundled plugin.
   * A matching build-time patch lives in
   * apps/controller/scripts/bundle-runtime-plugins.mjs so freshly-built
   * bundles already carry the fix — this method catches stale bundles
   * that were built before the patch existed.
   */
  private async patchTabbyControlPlugin(pluginDir: string): Promise<void> {
    const target = path.join(pluginDir, "dist", "task-coordinator.js");
    const original =
      "const SCREENSHOT_DIR = join(homedir(), '.openclaw', 'media', 'tabby-screenshots');";
    const patched =
      "const SCREENSHOT_DIR = join(process.env.OPENCLAW_STATE_DIR || join(homedir(), '.openclaw'), 'media', 'tabby-screenshots');";
    try {
      let content = await readFile(target, "utf8");
      if (content.includes(original)) {
        content = content.replace(original, patched);
        await writeFile(target, content, "utf8");
      }

      // Add screenshot pruning (keep only today's screenshots)
      const pruneFunc = `function pruneOldScreenshots() { try { const today = new Date(); today.setHours(0, 0, 0, 0); for (const f of fs.readdirSync(SCREENSHOT_DIR)) { if (!f.endsWith('.webp')) continue; const p = join(SCREENSHOT_DIR, f); try { if (fs.statSync(p).mtime < today) fs.unlinkSync(p); } catch {} } } catch {} }`;
      const screenshotDirLine = content.includes("OPENCLAW_STATE_DIR")
        ? "const SCREENSHOT_DIR = join(process.env.OPENCLAW_STATE_DIR || join(homedir(), '.openclaw'), 'media', 'tabby-screenshots');"
        : "const SCREENSHOT_DIR = join(homedir(), '.openclaw', 'media', 'tabby-screenshots');";
      if (!content.includes("pruneOldScreenshots")) {
        content = content.replace(
          screenshotDirLine,
          `${screenshotDirLine}\n${pruneFunc}`,
        );
        content = content.replace(
          /console\.log\(`\[tabby-control\] Created screenshot dir: \$\{SCREENSHOT_DIR\}`\);?\n(\s*)\}/,
          "console.log(`[tabby-control] Created screenshot dir: ${SCREENSHOT_DIR}`);\n$1}\n$1pruneOldScreenshots();",
        );
        content = content.replace(
          /(\s+)}\n(\s+)this\.ipcNotifier/,
          "$1}\n$1pruneOldScreenshots();\n$2this.ipcNotifier",
        );
        await writeFile(target, content, "utf8");
      }

      // Patch cancelTask to reject the pending promise when a task is cancelled.
      // Without this, executeTask() hangs forever until the 900s request timeout.
      const cancelPattern =
        "clearTimeout(pending.timeout);\n            this.pending.delete(taskId);";
      const cancelReplacement =
        "clearTimeout(pending.timeout);\n            this.pending.delete(taskId);\n            pending.reject(new Error('CANCELLED'));";
      if (content.includes(cancelPattern) && !content.includes("CANCELLED")) {
        content = content.replace(cancelPattern, cancelReplacement);
        await writeFile(target, content, "utf8");
      }
    } catch {
      // File missing or unreadable — non-fatal; the image-tool gate will
      // surface a descriptive error if screenshots land in the wrong dir.
    }

    // Patch device_execute_task description to guide agents toward autonomous sub-task mode
    const toolsTarget = path.join(pluginDir, "dist", "tools.js");
    try {
      let content = await readFile(toolsTarget, "utf8");
      if (content.includes("ENTIRE task")) {
        const oldDesc =
          "            'IMPORTANT: Send the ENTIRE task to the device in one call. Do NOT split the task',\n" +
          "            'into sub-steps yourself. The device handles all steps autonomously. For example,',\n" +
          "            'if the user says \"open WeChat and send a message to Zhang San\", send the full',\n" +
          "            'task \"打开微信给张三发消息：今晚吃饭吗\" in one device_execute_task call.',";

        const newDesc =
          "            'DEFAULT (autonomous mode): Send SUB-TASKS (2~3 steps each) to the device via',\n" +
          "            'device_execute_task. The device VLM runs autonomously within each sub-task.',\n" +
          "            'For multi-step workflows, decompose into 2~3 sub-tasks and execute them',\n" +
          "            'sequentially, verifying results between each. This scales to multi-device.',\n" +
          "            '',\n" +
          "            'FALLBACK (step-by-step mode): Only use device_execute_skill when the device VLM',\n" +
          "            'is unstable (repeated stuck/wrong-app/re-loop). It sends ≤3 steps at a time.',";

        content = content.replace(oldDesc, newDesc);
        await writeFile(toolsTarget, content, "utf8");
      }
    } catch {
      // tools.js missing — non-fatal
    }

    // Patch device_list + device_execute_batch descriptions so the orchestrator
    // splits independent work across multiple devices (parallel) instead of
    // piling a multi-part task onto one device. These two tools are otherwise
    // unpatched, so the original-text anchors below match the bundled tools.js.
    // Keep IN SYNC with scripts/bundle-runtime-plugins.mjs.
    try {
      let content = await readFile(toolsTarget, "utf8");
      let changed = false;

      const listAnchor =
        "            'Use this first to discover available devices before sending tasks.',";
      if (content.includes(listAnchor)) {
        content = content.replace(
          listAnchor,
          "            'Use this first to discover available devices before sending tasks.',\n" +
            "            'PARALLELIZE ACROSS DEVICES: when the task splits into independent parts (multiple',\n" +
            "            'keywords / accounts / targets) and 2+ devices are idle, split the work and run the',\n" +
            "            'parts in parallel via device_execute_batch — one part per device — rather than running',\n" +
            "            'the whole task on one device. With only ONE device, still split into sequential',\n" +
            "            'single-part tasks instead of one mega-task, so each task stays small and finishes',\n" +
            "            'cleanly (the device counts e.g. 前10篇 per task then COMPLETEs).',",
        );
        changed = true;
      }

      const batchAnchor =
        "            'Send different natural language tasks to different devices at the same time.',\n" +
        "            'Each device runs its own independent agent loop.',\n" +
        "            'Example: device A opens WeChat while device B opens DingTalk.',";
      if (content.includes(batchAnchor)) {
        content = content.replace(
          batchAnchor,
          "            'Send different natural language tasks to different devices at the same time (parallel).',\n" +
            "            'Each device runs its own independent agent loop and returns its own result; you then',\n" +
            "            'aggregate the results.',\n" +
            "            'USE THIS whenever the task splits into independent parts and 2+ devices are connected:',\n" +
            "            'it is faster and keeps every device task small. Give ONE part per task.',\n" +
            "            'Example: 用户说「搜索羽毛球、足球、匹克球各前10篇并汇总」，有3台空闲设备 →',\n" +
            "            'tasks=[{deviceId:dev1, task:在小红书搜索羽毛球，浏览前10篇笔记并逐篇总结要点},',\n" +
            "            '{deviceId:dev2, task:在小红书搜索足球，浏览前10篇笔记并逐篇总结要点},',\n" +
            "            '{deviceId:dev3, task:在小红书搜索匹克球，浏览前10篇笔记并逐篇总结要点}]。',\n" +
            "            'More parts than devices → put the remainder in a follow-up batch after this returns.',",
        );
        changed = true;
      }

      const allAnchor =
        "            'Useful for parallel operations like \"open WeChat on all devices\".',";
      if (content.includes(allAnchor)) {
        content = content.replace(
          allAnchor,
          "            'Useful for parallel operations like \"open WeChat on all devices\".',\n" +
            "            'For DIFFERENT tasks per device (each handles a different keyword/account/target), use',\n" +
            "            'device_execute_batch instead — this tool sends the SAME task to every device.',",
        );
        changed = true;
      }

      if (changed) {
        await writeFile(toolsTarget, content, "utf8");
      }
    } catch {
      // tools.js missing — non-fatal
    }
  }
}
