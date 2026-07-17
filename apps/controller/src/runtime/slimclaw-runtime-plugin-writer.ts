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
  "whatsapp",
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
