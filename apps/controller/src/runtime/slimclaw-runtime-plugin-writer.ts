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

    // Patch tabby-rednote SKILL.md with execution strategy (idempotent)
    await this.patchTabbyRednoteSkill(
      this.env.openclawSkillsDir,
      "tabby-rednote",
    );

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

  /**
   * Patch tabby-rednote SKILL.md and references/post.md to inject dual-layer
   * orchestration guidance.
   *
   * The default execution mode is **autonomous** (device_execute_task) where
   * the phone-side VLM executes sub-tasks independently.  If the phone VLM is
   * unstable, agents should fall back to step-by-step device_execute_skill.
   *
   * The skill is installed from SkillHub (not source-controlled), so we patch
   * it at runtime.  The patch is idempotent: it checks for marker strings
   * before injecting.
   */
  private async patchTabbyRednoteSkill(
    skillsDir: string,
    skillName: string,
  ): Promise<void> {
    const skillMd = path.join(skillsDir, skillName, "SKILL.md");
    const postMd = path.join(skillsDir, skillName, "references", "post.md");
    try {
      // Inject execution strategy into SKILL.md if missing
      let content = await readFile(skillMd, "utf8");
      if (
        !content.includes("执行策略") ||
        content.includes("必须使用 `device_execute_skill`")
      ) {
        const oldStrategy = content.match(/\n\n## 执行策略[\s\S]*?(?=\n\n## )/);
        if (oldStrategy) {
          content = content.replace(oldStrategy[0], "");
        }
        const injection =
          "\n\n## 执行策略\n\n本技能采用**双层自治架构**：\n\n### 默认模式：自主执行（device_execute_task）\n\n将整体任务拆解为 **2~3 个子任务**，每个子任务包含 2~3 步相关操作，用自然语言描述后通过 `device_execute_task` 下发给手机端自主执行。手机端 VLM 会在子任务内部自主循环（截图→分析→操作→截图→…），直到完成或遇到问题才上报。\n\n### 降级模式：逐步执行（device_execute_skill）\n\n当手机端 VLM 不稳定时（频繁 stuck、跳转错误应用、重复点击），降级为 `device_execute_skill`，将操作拆分为 ≤3 步的子任务逐组下发。\n";
        const frontmatterEnd = content.indexOf("---", 4);
        if (frontmatterEnd !== -1) {
          const insertPos = content.indexOf("\n", frontmatterEnd + 3) + 1;
          content =
            content.slice(0, insertPos) + injection + content.slice(insertPos);
          await writeFile(skillMd, content, "utf8");
        }
      }

      // Inject XHSEditor guidance into SKILL.md if missing
      if (!content.includes("内容可视化")) {
        const xhsInjection =
          '\n\n## 内容可视化\n\n当用户要求生成小红书笔记内容（标题、正文、话题标签等）时，**必须**调用 `render_a2ui` 工具将内容渲染为可视化编辑卡片，而非仅以纯文本输出。\n\n调用方式：\n```json\n{\n  "surfaceId": "sidebar:xhs-editor",\n  "catalogId": "https://nexu.app/a2ui/custom-catalog.json",\n  "components": [\n    {\n      "id": "xhs-editor",\n      "type": "XHSEditor",\n      "title": "笔记标题",\n      "content": "笔记正文内容...",\n      "images": [],\n      "hashtags": ["穿搭", "OOTD"],\n      "maxTitleLength": 20\n    }\n  ]\n}\n```\n\n**要点**：\n- `surfaceId` 必须以 `sidebar:` 开头，这样编辑卡片会自动在右侧边栏打开\n- 先调用 `render_a2ui` 展示内容，再下发 `device_execute_task` 执行发布操作\n- 用户可在编辑卡片中修改标题、正文、话题，点击"确认更新"后更新内容\n- 如果用户没有提供标题，根据正文内容自动生成一个不超过20字的标题\n';
        // Insert before "通用执行前提"
        const prereqIdx = content.indexOf("## 通用执行前提");
        if (prereqIdx !== -1) {
          content =
            content.slice(0, prereqIdx) + xhsInjection + content.slice(prereqIdx);
          await writeFile(skillMd, content, "utf8");
        }
      }

      // Inject sub-task decomposition into post.md if missing
      let postContent = await readFile(postMd, "utf8");
      if (!postContent.includes("子任务分解")) {
        const postInjection =
          "\n\n## 子任务分解\n\n### 子任务 1：打开发布入口并选择类型\n使用 `device_execute_task` 发送：\n```\n\"打开小红书 App，点击底部导航栏中间的红色'+'按钮，在弹出的半屏抽屉中，如果发布模式为 text 则点击'写文字'，如果为 photo 则点击'从相册选择'\"\n```\n验收：text 进入封面图生成页 / photo 进入图片选择页\n\n### 子任务 2：选择素材并填写标题正文\n使用 `device_execute_task` 发送（photo 模式）：\n```\n\"在相册选择页面点选第一张图片，点击右下角'下一步'，进入编辑页后再次点击'下一步'，然后在标题输入框（占位文字'添加标题'）输入标题，在正文输入框输入正文\"\n```\n或（text 模式）：\n```\n\"在文字封面图页面输入标题精简内容，点击'下一步'，选择效果模板后点击'下一步'，然后在标题输入框输入标题，在正文输入框输入正文\"\n```\n验收：笔记编辑页标题正文已填写\n\n### 子任务 3：添加标签并发布\n使用 `device_execute_task` 发送：\n```\n\"点击'#话题'按钮搜索添加话题标签，然后点击右上角红色'发布'按钮（键盘弹起时）或页面底部'发布笔记'按钮（键盘隐藏时）\"\n```\n验收：出现发布进度提示\n\n## 降级模式\n若 `device_execute_task` 子任务连续返回 stuck，切换为 `device_execute_skill` 逐步模式：步骤组1（maxSteps=3）打开发布入口并选择类型 → 步骤组2（maxSteps=3）选择素材填标题正文 → 步骤组3（maxSteps=3）添加标签发布。\n";
        postContent += postInjection;
        await writeFile(postMd, postContent, "utf8");
      }
    } catch {
      // Skill not installed yet — non-fatal
    }
  }
}
