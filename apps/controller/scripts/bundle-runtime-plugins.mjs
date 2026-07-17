import { existsSync, readdirSync, realpathSync } from "node:fs";
import { cp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const controllerRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(controllerRoot, "..", "..");
const outputRoot = path.join(controllerRoot, ".dist-runtime", "plugins");
const requireFromRepo = createRequire(path.join(repoRoot, "package.json"));

const bundledPlugins = [
  {
    id: "dingtalk-connector",
    npmName: "@dingtalk-real-ai/dingtalk-connector",
  },
  {
    id: "openclaw-lark",
    npmName: "@larksuite/openclaw-lark",
  },
  {
    id: "openclaw-weixin",
    npmName: "@tencent-weixin/openclaw-weixin",
  },
  {
    id: "openclaw-qqbot",
    npmName: "@tencent-connect/openclaw-qqbot",
  },
  {
    id: "tabby-control",
    // Local repo — resolved from TBBY_CONTROL_DIR env or default workspace path
    localSource: true,
  },
  {
    id: "wecom",
    npmName: "@wecom/wecom-openclaw-plugin",
  },
  {
    id: "whatsapp",
    npmName: "@openclaw/whatsapp",
  },
];

const MANIFEST_ID_FIXES = {
  "wecom-openclaw-plugin": "wecom",
};

function shouldCopyPluginPath(source) {
  const basename = path.basename(source);
  return basename !== ".bin" && basename !== "node_modules";
}

function getVirtualStoreNodeModules(realPkgPath) {
  let currentPath = realPkgPath;
  while (currentPath !== dirname(currentPath)) {
    if (path.basename(currentPath) === "node_modules") {
      return currentPath;
    }
    currentPath = dirname(currentPath);
  }
  return null;
}

function getPackageNodeModules(packageRoot) {
  const candidate = path.join(packageRoot, "node_modules");
  try {
    readdirSync(candidate);
    return candidate;
  } catch {
    return null;
  }
}

function hasRealPackages(nodeModulesDir) {
  try {
    return listPackages(nodeModulesDir).length > 0;
  } catch {
    return false;
  }
}

export function resolveDependencyNodeModules(packageRoot) {
  const packageNodeModules = getPackageNodeModules(packageRoot);
  if (packageNodeModules && hasRealPackages(packageNodeModules)) {
    return packageNodeModules;
  }

  return getVirtualStoreNodeModules(packageRoot);
}

function listPackages(nodeModulesDir) {
  const result = [];

  for (const entry of readdirSync(nodeModulesDir)) {
    if (entry === ".bin") {
      continue;
    }

    const fullPath = path.join(nodeModulesDir, entry);
    if (entry.startsWith("@")) {
      let scopedEntries = [];
      try {
        scopedEntries = readdirSync(fullPath);
      } catch {
        continue;
      }

      for (const subEntry of scopedEntries) {
        result.push({
          name: `${entry}/${subEntry}`,
          fullPath: path.join(fullPath, subEntry),
        });
      }
      continue;
    }

    result.push({ name: entry, fullPath });
  }

  return result;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function maybeFixPluginManifest(outputDir) {
  const manifestPath = path.join(outputDir, "openclaw.plugin.json");
  try {
    const manifest = await readJson(manifestPath);
    const oldId = manifest.id;
    if (typeof oldId === "string" && MANIFEST_ID_FIXES[oldId]) {
      manifest.id = MANIFEST_ID_FIXES[oldId];
      await writeFile(
        manifestPath,
        `${JSON.stringify(manifest, null, 2)}\n`,
        "utf8",
      );
    }
  } catch {
    // Ignore plugins that do not ship a manifest at bundle time.
  }

  const pkgPath = path.join(outputDir, "package.json");
  try {
    const pkg = await readJson(pkgPath);
    let modified = false;
    for (const [oldId, newId] of Object.entries(MANIFEST_ID_FIXES)) {
      if (typeof pkg.name === "string" && pkg.name.includes(oldId)) {
        pkg.name = pkg.name.replaceAll(oldId, newId);
        modified = true;
      }
    }
    if (modified) {
      await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
    }

    const entryFiles = [pkg.main, pkg.module].filter(
      (value) => typeof value === "string" && value.length > 0,
    );
    for (const entryFile of entryFiles) {
      const entryPath = path.join(outputDir, entryFile);
      try {
        let content = await readFile(entryPath, "utf8");
        let patched = false;
        for (const [oldId, newId] of Object.entries(MANIFEST_ID_FIXES)) {
          const escapedOldId = oldId.replaceAll("-", "\\-");
          const pattern = new RegExp(
            `(\\bid\\s*:\\s*)(["'])${escapedOldId}\\2`,
            "g",
          );
          const nextContent = content.replace(pattern, `$1$2${newId}$2`);
          if (nextContent !== content) {
            content = nextContent;
            patched = true;
          }
        }
        if (patched) {
          await writeFile(entryPath, content, "utf8");
        }
      } catch {
        // Ignore missing entry files during bundle-time fixups.
      }
    }
  } catch {
    // Ignore plugins without a package manifest.
  }
}

/**
 * Patch tabby-control's task-coordinator.js so SCREENSHOT_DIR honours
 * OPENCLAW_STATE_DIR (or falls back to ~/.openclaw) and add screenshot
 * pruning that keeps only today's screenshots.  The upstream source
 * hard-codes `join(homedir(), '.openclaw', …)`, which only works when the
 * OpenClaw process uses the default state dir — not in dev mode or the
 * packaged desktop where OPENCLAW_STATE_DIR points elsewhere.
 */
async function patchTabbyControlTaskDescription(outputDir) {
  const target = path.join(outputDir, "dist", "tools.js");
  try {
    let content = await readFile(target, "utf8");

    // Replace the "Send ENTIRE task" guidance with autonomous sub-task mode
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

    if (content.includes("ENTIRE task")) {
      content = content.replace(oldDesc, newDesc);
      // Also update the examples section
      const oldExamples =
        "            'Examples:',\n" +
        '            \'- "打开小红书，浏览首页前三屏内容" (NOT split into "open app" + "scroll" + "report")\',\n' +
        "            '- \"打开微信给张三发消息：今晚吃饭吗\"',\n" +
        "            '- \"在小红书搜索美食并截图\"',";

      const newExamples =
        "            'Autonomous sub-task examples (use device_execute_task):',\n" +
        "            '- \"在小红书点击底部+号，选择写文字\"',\n" +
        "            '- \"填写标题和正文内容\"',\n" +
        "            '- \"添加话题标签并点击发布\"',\n" +
        "            '',\n" +
        "            'Fallback step-by-step examples (use device_execute_skill only if unstable):',\n" +
        "            '- \"在小红书发布一篇笔记\" → decompose into ≤3-step groups',";
      content = content.replace(oldExamples, newExamples);
      await writeFile(target, content, "utf8");
      console.log(
        "  [tabby-control] Patched device_execute_task description to prefer device_execute_skill for multi-step tasks",
      );
    } else if (content.includes("device_execute_skill")) {
      console.log(
        "  [tabby-control] device_execute_task description already patched — skipping",
      );
    } else {
      console.warn(
        `  [tabby-control] Could not find device_execute_task description in ${target} — manual review needed`,
      );
    }

    // device_list + device_execute_batch: guide the orchestrator to split
    // independent work across multiple devices (parallel) instead of piling a
    // multi-part task onto one device. Applied independently of the
    // device_execute_task patch above (runs even on an already-patched bundle).
    // Keep IN SYNC with src/runtime/slimclaw-runtime-plugin-writer.ts.
    let distChanged = false;
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
      distChanged = true;
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
      distChanged = true;
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
      distChanged = true;
    }

    if (distChanged) {
      await writeFile(target, content, "utf8");
      console.log(
        "  [tabby-control] Patched device_list/device_execute_batch for multi-device parallel split",
      );
    }
  } catch {
    console.warn(
      `  [tabby-control] ${target} not found — task-description patch skipped`,
    );
  }
}

async function patchTabbyControlScreenshotDir(outputDir) {
  const target = path.join(outputDir, "dist", "task-coordinator.js");
  try {
    let content = await readFile(target, "utf8");
    const original =
      "const SCREENSHOT_DIR = join(homedir(), '.openclaw', 'media', 'tabby-screenshots');";
    const patched =
      "const SCREENSHOT_DIR = join(process.env.OPENCLAW_STATE_DIR || join(homedir(), '.openclaw'), 'media', 'tabby-screenshots');";
    if (content.includes(original)) {
      content = content.replace(original, patched);
      await writeFile(target, content, "utf8");
      console.log(
        "  [tabby-control] Patched SCREENSHOT_DIR to respect OPENCLAW_STATE_DIR",
      );
    } else if (content.includes("OPENCLAW_STATE_DIR")) {
      console.log(
        "  [tabby-control] SCREENSHOT_DIR already patched — skipping",
      );
    } else {
      console.warn(
        `  [tabby-control] Could not find SCREENSHOT_DIR pattern in ${target} — manual review needed`,
      );
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
      console.log(
        "  [tabby-control] Added screenshot pruning (keep today only)",
      );
    } else {
      console.log(
        "  [tabby-control] Screenshot pruning already present — skipping",
      );
    }
  } catch {
    console.warn(
      `  [tabby-control] ${target} not found — screenshot-dir patch skipped`,
    );
  }
}

/**
 * Patch tabby-control's task-coordinator.js so that cancelTask() rejects the
 * pending promise (fixing a bug where executeTask hangs indefinitely) and
 * handleTaskMessage handles 'agent.cancel' method from the phone.
 */
async function patchTabbyControlCancelTask(outputDir) {
  const target = path.join(outputDir, "dist", "task-coordinator.js");
  try {
    let content = await readFile(target, "utf8");

    // 1. cancelTask: reject the pending promise after clearing/deleting it
    if (!content.includes("CANCELLED")) {
      const before =
        "clearTimeout(pending.timeout);\n            this.pending.delete(taskId);\n        }";
      const after =
        "clearTimeout(pending.timeout);\n            this.pending.delete(taskId);\n            pending.reject(new Error('CANCELLED'));\n        }";
      if (content.includes(before)) {
        content = content.replace(before, after);
        console.log(
          "  [tabby-control] Patched cancelTask to reject pending promise",
        );
      } else {
        console.warn(
          `  [tabby-control] Could not find cancelTask reject pattern in ${target} — manual review needed`,
        );
      }
    } else {
      console.log(
        "  [tabby-control] cancelTask already rejects pending — skipping",
      );
    }

    // 2. handleTaskMessage: handle 'agent.cancel' method from phone
    if (!content.includes("'agent.cancel'")) {
      const cancelHandlerInsert = `    // ── Cancel from phone ──
    if (method === 'agent.cancel') {
        const cancelTaskId = message.params?.taskId;
        if (cancelTaskId) {
            const pending = this.pending.get(cancelTaskId);
            if (pending) {
                clearTimeout(pending.timeout);
                this.pending.delete(cancelTaskId);
                pending.reject(new Error('CANCELLED'));
                this.wsServer.getRegistry().updateStatus(deviceId, { status: 'idle', currentTaskId: undefined });
                this.ipcNotifier('device:status_change', { deviceId, status: 'idle', taskId: undefined });
            }
        }
        return;
    }

`;
      // Insert after the subtask return and before "// ── Result"
      const resultComment =
        "        // ── Result ────────────────────────────────────────────────";
      if (content.includes(resultComment)) {
        content = content.replace(
          resultComment,
          `${cancelHandlerInsert}        ${resultComment.trim()}`,
        );
        console.log(
          "  [tabby-control] Patched handleTaskMessage to handle agent.cancel from phone",
        );
      } else {
        console.warn(
          `  [tabby-control] Could not find result comment in ${target} — agent.cancel handler patch skipped`,
        );
      }
    } else {
      console.log(
        "  [tabby-control] handleTaskMessage already handles agent.cancel — skipping",
      );
    }

    await writeFile(target, content, "utf8");
  } catch {
    console.warn(
      `  [tabby-control] ${target} not found — cancel-task patch skipped`,
    );
  }
}

async function bundlePlugin({ id, npmName, localSource }) {
  let sourcePackageRoot;

  if (localSource) {
    const tabbyControlDir =
      process.env.TABBY_CONTROL_DIR ||
      path.resolve(repoRoot, "..", "tabby-control");
    const tabbyDistNexu = path.join(
      tabbyControlDir,
      "dist-nexu",
      "tabby-control",
    );
    if (!existsSync(path.join(tabbyDistNexu, "openclaw.plugin.json"))) {
      console.warn(
        `  [${id}] source not found at ${tabbyDistNexu} — skipping. Run "pnpm build:nexu" in the tabby-control repo (or set TABBY_CONTROL_DIR) to bundle device control.`,
      );
      return;
    }
    sourcePackageRoot = await realpath(tabbyDistNexu);
  } else {
    // Resolve the package root directory.
    // Some packages (e.g. @larksuite/openclaw-lark) restrict "exports" and
    // don't expose ./package.json or a CJS main, so we try multiple strategies.
    let sourceDir;
    try {
      // Strategy 1: resolve package.json directly (works for most packages)
      const packageJsonPath = requireFromRepo.resolve(
        `${npmName}/package.json`,
      );
      sourceDir = path.dirname(packageJsonPath);
    } catch {
      // Strategy 2: resolve the main entry and walk up to find package.json
      try {
        const mainEntry = requireFromRepo.resolve(npmName);
        let dir = path.dirname(mainEntry);
        for (let i = 0; i < 20; i++) {
          const candidate = path.join(dir, "package.json");
          try {
            const pkg = await readJson(candidate);
            if (pkg.name === npmName) {
              sourceDir = dir;
              break;
            }
          } catch {
            // not a valid package.json, keep walking
          }
          const parent = path.dirname(dir);
          if (parent === dir) break;
          dir = parent;
        }
      } catch {
        // Strategy 2 failed
      }
    }
    // Strategy 3: direct path construction for scoped packages
    // pnpm hoists to node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>/
    // but also creates a symlink at node_modules/<scope>/<pkg>/
    if (!sourceDir) {
      const directPath = path.join(repoRoot, "node_modules", npmName);
      try {
        const pkg = await readJson(path.join(directPath, "package.json"));
        if (pkg.name === npmName) {
          sourceDir = directPath;
        }
      } catch {
        // direct path doesn't exist
      }
    }
    if (!sourceDir) {
      throw new Error(
        `Missing ${npmName}. Run "pnpm install" at the repo root before building controller runtime plugins.`,
      );
    }
    sourcePackageRoot = await realpath(sourceDir);
  }
  const outputDir = path.join(outputRoot, id);

  await cp(sourcePackageRoot, outputDir, {
    recursive: true,
    force: true,
    dereference: true,
    filter: localSource ? undefined : shouldCopyPluginPath,
  });
  await maybeFixPluginManifest(outputDir);

  // Patch tabby-control to respect OPENCLAW_STATE_DIR when writing screenshots.
  // Without this, SCREENSHOT_DIR resolves to ~/.openclaw/media/tabby-screenshots,
  // which is outside the image tool's localRoots when OPENCLAW_STATE_DIR is set
  // (dev mode / packaged desktop).  See AGENTS.md "Do not modify OpenClaw source code"
  // — this patches a bundled extension, not the OpenClaw runtime itself.
  if (id === "tabby-control") {
    await patchTabbyControlScreenshotDir(outputDir);
    await patchTabbyControlTaskDescription(outputDir);
    await patchTabbyControlCancelTask(outputDir);
  }

  // Skip npm dependency closure for local-source plugins (they bundle their own node_modules)
  if (localSource) {
    return;
  }

  const rootDependencyNodeModules =
    resolveDependencyNodeModules(sourcePackageRoot);
  if (!rootDependencyNodeModules) {
    throw new Error(`Unable to resolve node_modules for ${npmName}`);
  }

  const packageJson = await readJson(path.join(outputDir, "package.json"));
  const skipPackages = new Set([
    "typescript",
    "@playwright/test",
    ...Object.keys(packageJson.peerDependencies ?? {}),
  ]);
  const collected = new Map();
  const queue = [
    { nodeModulesDir: rootDependencyNodeModules, skipPkg: npmName },
  ];

  while (queue.length > 0) {
    const { nodeModulesDir, skipPkg } = queue.shift();
    for (const { name, fullPath } of listPackages(nodeModulesDir)) {
      if (
        name === skipPkg ||
        skipPackages.has(name) ||
        name.startsWith("@types/")
      ) {
        continue;
      }

      let realPackagePath;
      try {
        realPackagePath = realpathSync(fullPath);
      } catch {
        continue;
      }

      if (collected.has(realPackagePath)) {
        continue;
      }
      collected.set(realPackagePath, name);

      const depVirtualNodeModules = getVirtualStoreNodeModules(realPackagePath);
      if (depVirtualNodeModules && depVirtualNodeModules !== nodeModulesDir) {
        queue.push({ nodeModulesDir: depVirtualNodeModules, skipPkg: name });
      }
    }
  }

  const outputNodeModules = path.join(outputDir, "node_modules");
  await mkdir(outputNodeModules, { recursive: true });

  const copiedNames = new Set();
  for (const [realPackagePath, packageName] of collected) {
    if (copiedNames.has(packageName)) {
      continue;
    }
    copiedNames.add(packageName);

    const destinationPath = path.join(outputNodeModules, packageName);
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await rm(destinationPath, { recursive: true, force: true });
    await cp(realPackagePath, destinationPath, {
      recursive: true,
      force: true,
      dereference: true,
      filter: shouldCopyPluginPath,
    });
  }
}

async function main() {
  // Optional BUNDLE_PLUGINS=id[,id] filter for targeted rebuilds (e.g. local dev
  // staging just "tabby-control"). Unset = bundle everything (build/packaging).
  const only = (process.env.BUNDLE_PLUGINS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const selected = only.length
    ? bundledPlugins.filter((plugin) => only.includes(plugin.id))
    : bundledPlugins;

  if (only.length) {
    // Refresh only the selected plugins; leave any other bundled output intact.
    await mkdir(outputRoot, { recursive: true });
    for (const plugin of selected) {
      await rm(path.join(outputRoot, plugin.id), {
        recursive: true,
        force: true,
      });
    }
  } else {
    await rm(outputRoot, { recursive: true, force: true });
    await mkdir(outputRoot, { recursive: true });
  }

  for (const plugin of selected) {
    await bundlePlugin(plugin);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
