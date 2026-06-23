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
import type { ControllerEnv } from "../app/env.js";

const BUNDLED_PLUGIN_IDS = new Set([
  "dingtalk-connector",
  "openclaw-lark",
  "openclaw-weixin",
  "openclaw-qqbot",
  "tabby-control",
  "wecom",
]);

export class OpenClawRuntimePluginWriter {
  constructor(private readonly env: ControllerEnv) {}

  async ensurePlugins(): Promise<void> {
    await mkdir(this.env.openclawExtensionsDir, { recursive: true });
    const handledPluginIds = await this.ensureBundledPlugins();

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
  }
}
