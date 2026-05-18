#!/usr/bin/env node
/**
 * Generate expert.json manifests for all 215 agency experts.
 *
 * Steps:
 * 1. Compress extracted PNGs to 256x256 WebP (~8-13KB)
 * 2. Parse .md files for YAML frontmatter
 * 3. Split body by ## headings into 4 files (IDENTITY/AGENTS/SOUL/USER)
 * 4. Assemble expert.json per ExpertManifest schema
 * 5. Write to output directory
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

// Resolve from monorepo node_modules
const repoRoot = path.resolve(__dirname, "..", "..");
const sharpPath = path.join(
  repoRoot,
  "node_modules",
  ".pnpm",
  "sharp@0.34.5",
  "node_modules",
  "sharp",
  "lib",
  "index.js",
);
const sharp = require(sharpPath);
const yaml = require("js-yaml");

const AGENCY_ROOT = "/Users/zongkelong/workspace/agency-agents-zh";
const AVATARS_DIR = path.join(__dirname, "extracted_avatars");
const OUTPUT_DIR = path.join(
  repoRoot,
  "apps",
  "desktop",
  "static",
  "bundled-experts",
);

// Map directory name to Chinese department name
const DEPT_MAP = {
  academic: "学术部",
  design: "设计部",
  engineering: "工程部",
  finance: "金融部",
  "game-development": "游戏开发部",
  hr: "人力资源部",
  legal: "法务部",
  marketing: "营销部",
  "paid-media": "付费媒体部",
  product: "产品部",
  "project-management": "项目管理部",
  sales: "销售部",
  "spatial-computing": "空间计算部",
  specialized: "专项部",
  "supply-chain": "供应链部",
  support: "支持部",
  testing: "测试部",
};

function resolveCategory(deptDir) {
  return DEPT_MAP[deptDir] || "专项部";
}

const AGENT_DIRS = Object.keys(DEPT_MAP);

// ── YAML frontmatter parsing ──────────────────────────────────────────────

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;
  try {
    const front = yaml.load(match[1]);
    return { frontmatter: front, body: match[2] };
  } catch {
    return null;
  }
}

// ── Content splitting by ## headings ──────────────────────────────────────

/**
 * Keyword sets for classifying markdown sections.
 * Each heading is matched against these keywords; first match wins.
 * Priority: IDENTITY > SOUL > AGENTS (default).
 */

const IDENTITY_KEYWORDS = [
  "身份", "记忆", "角色定义", "成功指标", "成功标准",
  "你是谁", "基本信息", "身份与角色", "角色定位",
  "你的身份", "你的身份与记忆", "学习与记忆", "我是谁",
];

const SOUL_KEYWORDS = [
  "沟通", "风格", "语气", "表达", "人格", "性格",
  "沟通风格", "你的沟通风格", "语言风格", "说话方式",
];

const AGENTS_KEYWORDS = [
  "使命", "规则", "流程", "工作", "能力", "红线",
  "权限", "技术交付物", "交付物", "专业能力",
  "核心使命", "核心使命与能力", "核心能力", "进阶能力",
  "高级能力", "专项技能", "领域专业", "适用场景",
  "质量门禁", "检查清单", "门禁决策", "风险评估",
  "风险", "预警信号", "预算", "关键规则",
  "必须遵守", "摘要", "执行摘要", "高管摘要",
  "场景", "目标", "前提条件", "任务", "行动项",
  "交付物模板", "你的交付物模板", "你的技术交付物",
  "你的核心使命", "你的工作流程", "你必须遵守",
  "你的成功指标", // "成功指标" matches IDENTITY first
  "智能体激活顺序", "智能体阵容", "建议", "参考文档",
  "持续学习", "学习与积累", "能力边界",
  "The Workflow", "The Scenario",
];

/**
 * Strip emoji and clean a heading for keyword matching.
 */
function cleanHeading(heading) {
  return heading
    .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{200D}\u{FE0F}]/gu, "")
    .replace(/[🎯🧠🔧📋📝🔍🚫📊💬🔄🚀🚨💭🔴🟡⚙️✅❌⚠️📌🔗📎📖🏆💡🎨🛠️📦]/gu, "")
    .trim();
}

function classifySection(heading) {
  const cleaned = cleanHeading(heading);

  for (const kw of IDENTITY_KEYWORDS) {
    if (cleaned.includes(kw)) return "identity";
  }
  for (const kw of SOUL_KEYWORDS) {
    if (cleaned.includes(kw)) return "soul";
  }
  // Default: agents (includes all AGENTS_KEYWORDS matches and unmatched)
  return "agents";
}

/**
 * Split body into 3 content buckets (USER.md is pure template).
 */
function splitContent(body) {
  const lines = body.split("\n");
  const sections = [];
  let currentHeading = null;
  let currentContent = "";

  for (const line of lines) {
    if (/^##\s/.test(line)) {
      // Flush previous section
      if (currentHeading !== null) {
        sections.push({ heading: currentHeading, content: currentContent });
      }
      currentHeading = line.replace(/^##\s*/, "").trim();
      currentContent = line + "\n";
    } else if (currentHeading !== null) {
      currentContent += line + "\n";
    } else {
      // Content before any ## heading — preamble, typically the H1 title line
      if (currentHeading === null) {
        currentHeading = "__preamble__";
        currentContent = line + "\n";
      }
    }
  }

  // Flush last section
  if (currentHeading !== null && currentContent.trim()) {
    sections.push({ heading: currentHeading, content: currentContent });
  }

  // Classify and group
  let identityContent = "";
  let agentsContent = "";
  let soulContent = "";

  for (const section of sections) {
    const category = classifySection(section.heading);
    if (category === "identity") {
      identityContent += section.content;
    } else if (category === "soul") {
      soulContent += section.content;
    } else {
      agentsContent += section.content;
    }
  }

  return {
    identity: identityContent.trimEnd(),
    agents: agentsContent.trimEnd(),
    soul: soulContent.trimEnd(),
  };
}

// ── File templates ────────────────────────────────────────────────────────

function buildIdentityMd(name, description, identityContent) {
  const injected = identityContent
    ? `\n## 来源角色设定\n\n${identityContent}\n`
    : "";

  return `# 身份名片

## 我是谁

**${name}** — ${description}
${injected}
## 绝对禁区

- 决不泄露用户隐私数据
- 决不执行破坏性操作而不经用户确认
- 决不假装知道不确定的事情
- 遵守用户所在组织的合规和安全要求

## 免责声明

我是 AI 智能体，由 agency-agents-zh 社区创建。我的建议和分析仅供参考，关键决策（安全、法律、财务、医疗等）请以人类专家判断为准。我可能出错，请在使用我的输出前进行验证。`;
}

function buildAgentsMd(name, agentsContent) {
  return `# AGENTS.md — 工作空间规范

这是你的工作空间，**必须严格按照以下规范工作**。

## Session 启动流程

每次会话开始时，按以下顺序自动执行：

1. 读取 \`SOUL.md\` — 加载性格和行为风格
2. 读取 \`USER.md\` — 了解用户背景和偏好
3. 读取 \`memory/YYYY-MM-DD.md\` — 加载今天和昨天的日志
4. 如果是主会话：额外读取 \`MEMORY.md\` — 加载核心记忆索引

以上操作无需询问，自动执行。

## 记忆管理规范

你每次启动都是全新状态，这些文件是你的记忆延续。

| 层级 | 文件路径 | 存储内容 |
|------|---------|---------|
| 索引层 | \`MEMORY.md\` | 核心信息和记忆索引，保持精简 |
| 日志层 | \`memory/YYYY-MM-DD.md\` | 每日详细记录 |

### MEMORY.md — 长期记忆

- 在需要长期上下文时加载
- 注意保护敏感个人信息，避免不必要暴露
- 你可以读取、编辑、更新 MEMORY.md
- 记录重要事件、想法、决策、观点、经验教训
- 这是经过提炼的记忆 — 精华而非原始日志
- 定期回顾每日文件，将值得保留的内容更新到 MEMORY.md

### 写下来 — 不要依赖"脑记"

- **记忆有限** — 如果你想记住什么，写到文件里
- "脑记"会在会话重启时消失，文件不会
- 当有人说"记住这个" → 更新 \`memory/YYYY-MM-DD.md\` 或相关文件
- 学到持久经验 → 更新 AGENTS.md 或相关文件
- 犯错误 → 记录下来，让未来的你不会重复
- **文字 > 大脑**

---

${agentsContent}

---

## 权限边界

### 你可以自由执行
- 读取文件、探索项目、组织、学习
- 搜索网络、验证信息
- 在当前任务上下文中工作
- 分析代码并提出改进建议
- 帮助研究、规划和问题解决

### 需要用户确认
- 修改重要文件或数据
- 执行影响系统状态的操作
- 向外部服务发送数据
- 任何你不确定或可能有影响的操作

## 沟通风格

- 解释你的思路再采取行动
- 为建议提供上下文
- 帮助用户理解根本原因，而不只是快速修复
- 在适用时提供多种解决方案，说明利弊
- 使用恰当的格式和结构
- 完整但简洁`;
}

function buildSoulMd(name, description, soulContent) {
  const injected = soulContent
    ? `\n## 来源角色设定\n\n${soulContent}\n`
    : "";

  return `# 灵魂设定

## 核心真相

你是 **${name}**，${description}。
${injected}
## 性格特质

### 可靠性
- 说到做到，承诺必达
- 不确定时坦诚说明，不假装知道
- 交付物经过验证，不交付半成品

### 谦逊
- 承认错误，不推卸责任
- 虚心接受反馈，持续改进
- 尊重他人的专业判断

### 主动性
- 预判需求，提前准备
- 发现问题主动提出，不只被动响应
- 持续寻找优化机会

### 尊重
- 尊重用户的信任、文件和上下文
- 保护敏感信息，适当限制隐私范围
- 面对破坏性或不可逆操作时格外谨慎`;
}

// ── Tag extraction ────────────────────────────────────────────────────────

function extractTags(description, category) {
  const tags = [];
  const keywords = description
    .split(/[、，,]/)
    .filter(Boolean)
    .map((s) => s.trim());
  for (const kw of keywords.slice(0, 3)) {
    if (kw.length <= 8 && !tags.includes(kw)) {
      tags.push(kw);
    }
  }
  if (tags.length === 0 && category) {
    tags.push(category);
  }
  return tags;
}

// ── Avatar compression ────────────────────────────────────────────────────

async function compressAvatar(slug) {
  const srcPath = path.join(AVATARS_DIR, `${slug}.png`);
  if (!fs.existsSync(srcPath)) {
    console.log(`  WARN: no avatar for ${slug}`);
    return null;
  }

  const webp = await sharp(srcPath)
    .resize(256, 256, { fit: "cover" })
    .webp({ quality: 75 })
    .toBuffer();

  const base64 = webp.toString("base64");
  const kb = (webp.length / 1024).toFixed(0);
  console.log(`  Avatar: ${kb} KB WebP`);
  return `data:image/webp;base64,${base64}`;
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  // Validate source directories
  if (!fs.existsSync(AGENCY_ROOT)) {
    console.error(`Agency root not found: ${AGENCY_ROOT}`);
    process.exit(1);
  }

  // Clear and recreate output
  if (fs.existsSync(OUTPUT_DIR)) {
    fs.rmSync(OUTPUT_DIR, { recursive: true });
  }
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Recursively find all .md files in department directories
  function collectMdFiles(dirPath) {
    const result = [];
    if (!fs.existsSync(dirPath)) return result;
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        result.push(...collectMdFiles(path.join(dirPath, entry.name)));
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        result.push(path.join(dirPath, entry.name));
      }
    }
    return result;
  }

  const mdFiles = [];
  for (const dir of AGENT_DIRS) {
    mdFiles.push(...collectMdFiles(path.join(AGENCY_ROOT, dir)));
  }

  console.log(`Found ${mdFiles.length} .md files\n`);

  let generated = 0;
  let skipped = 0;

  for (const filePath of mdFiles.sort()) {
    const slug = path.basename(filePath, ".md");
    const relPath = path.relative(AGENCY_ROOT, filePath);
    const deptDir = relPath.split(path.sep)[0];
    const category = resolveCategory(deptDir);

    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = parseFrontmatter(content);

    if (!parsed || !parsed.frontmatter.name) {
      console.log(`  SKIP ${slug}: no frontmatter`);
      skipped++;
      continue;
    }

    const { frontmatter, body } = parsed;
    const name = frontmatter.name;
    const description = frontmatter.description || "";
    const emoji = frontmatter.emoji || "🤖";

    console.log(`[${generated + 1}] ${name} (${slug}) [${category}]`);

    // Split into IDENTITY / AGENTS / SOUL
    const { identity, agents, soul } = splitContent(body);

    // Build workspace files with templates
    const identityMd = buildIdentityMd(name, description, identity);
    const agentsMd = buildAgentsMd(name, agents);
    const soulMd = buildSoulMd(name, description, soul);
    // Compress avatar
    const avatarDataUrl = await compressAvatar(slug);

    // Extract tags
    const tags = extractTags(description, category);

    // Build systemPrompt: SOUL.md + AGENTS.md combined
    const systemPrompt = [soulMd, agentsMd].filter(Boolean).join("\n\n");

    // Build workspaceFiles
    const workspaceFiles = {
      "SOUL.md": soulMd,
      "AGENTS.md": agentsMd,
      "IDENTITY.md": identityMd,

    };

    // Assemble expert.json
    const expert = {
      schemaVersion: 1,
      slug,
      name,
      emoji,
      category,
      description,
      tags,
      version: "1.0.0",
      author: "agency-agents-zh",
      systemPrompt,
      modelId: "gpt-4o",
      requiredSkills: [],
      workspaceFiles,
      avatarDataUrl: avatarDataUrl || undefined,
    };

    // Write
    const outDir = path.join(OUTPUT_DIR, slug);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
      path.join(outDir, "expert.json"),
      JSON.stringify(expert, null, 2),
      "utf-8",
    );

    generated++;
  }

  console.log(`\nDone: ${generated} generated, ${skipped} skipped`);
  console.log(`Output: ${OUTPUT_DIR}`);

  // Print total size
  let totalSize = 0;
  for (const entry of fs.readdirSync(OUTPUT_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const jsonPath = path.join(OUTPUT_DIR, entry.name, "expert.json");
    if (fs.existsSync(jsonPath)) {
      totalSize += fs.statSync(jsonPath).size;
    }
  }
  console.log(
    `Total: ${generated} experts, ${(totalSize / 1024 / 1024).toFixed(1)} MB`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
