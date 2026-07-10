# Nexu Teams 设计（专家组队完成任务）

> 状态：设计草案（待阶段 0 spike 验证后转实施计划）
> 创建：2026-06-15 ｜ 重写：2026-06-17（对齐 OpenClaw 2026.6.6 + 锁定想法2 + Workboard 复用）
> 目标版本：OpenClaw **2026.6.6**（桌面端已升级）
> 方案：A —— agentic 编排为主（OpenClaw 介入控制流）+ 复用 Workboard 引擎 + 硬护栏

---

## 0. 结论与已锁定决策

聚焦**想法2：多位专家作为一个团队协作完成一个任务**。（想法1「对话中自动调度单专家」暂缓；若做，主路径是「整段对话路由到该专家主会话」，见 §11。）

| # | 决策 | 影响 |
|---|---|---|
| D1 | **控制流归 LLM（agentic）**，不写死编排 DAG | lead agent 推理决定调谁/几个/顺序/何时停 |
| D2 | **委派全靠 OpenClaw 原生 `sessions_spawn`/`sessions_yield`** | 不自造 `delegate`、不自己 spawn agent |
| D3 | **命中未安装专家 → A2UI 卡片征求授权安装** | 复用现有 install-flow；用户始终在控制；不做 ephemeral 懒加载 |
| D4 | **简单问题 lead 自己答，复杂才拆/转** | 降低延迟与成本 |
| D5（2026-06-18 二次修正） | **保留 Workboard dispatcher 做执行**（留住持久调度/依赖门控/崩溃恢复），**人设经 `card.notes` 注入**（非 AGENTS.md） | dispatcher worker 不注入 AGENTS.md，但 `buildWorkerContext` 含 `card.notes(≤4KB)` → 拼进 worker prompt → 人设到达。`sessions_spawn`+AGENTS.md 折叠作备选。详见 §8c |

净结果：自建面大幅缩小——团队的**任务板 / 拆解 / 派发 / 依赖 / 预算 / Playbook** 用 Workboard + Goal + Task Flow 拼出；自建只剩 **语义选专家(find_experts) + 装专家授权(A2UI) + 编译接线 + 人设折叠 + Nexu 看板 UI**。

---

## 1. 当前模型与底座

现状：「1 专家 = 1 Bot = 1 OpenClaw agent = 1 会话」。用户先安装专家（[install-flow.ts](../../apps/controller/src/services/experthub/install-flow.ts)），再在新对话手动选中，聊天绑定到 `agent:${botId}:main`（[chat-service.ts](../../apps/controller/src/services/chat-service.ts)）。专家人设来自 manifest 的 `workspaceFiles`（**SOUL.md / AGENTS.md / IDENTITY.md**），编译器 **不** emit `systemPrompt`（[openclaw-config-compiler.ts](../../apps/controller/src/lib/openclaw-config-compiler.ts) `compileAgentList`）。

底座（OpenClaw 2026.6.6 原生）：

| 原生能力 | 用途 | 来源 |
|---|---|---|
| `sessions_spawn` / `sessions_yield`（子 agent） | 委派 + 等待汇总；`agentId` 定向、`allowAgents:["*"]` | docs/tools/subagents.md |
| **Workboard**（bundled 插件） | `cards.decompose` 拆卡 + 依赖链 + `cards.dispatch` 起 worker 子 agent + claim/complete/block + SQLite + RPC | docs/plugins/workboard.md |
| **Goal**（`create/get/update_goal`） | 单会话 durable 目标 + token 预算 | docs/tools/goal.md |
| **Task Flow**（YAML steps） | 将来可复现「团队 Playbook」的硬编排层 | docs/automation/taskflow.md |
| **parallel-specialist-lanes** | 多专家分工的官方范式（lane 契约 / coordinator 最后做） | docs/concepts/parallel-specialist-lanes.md |
| **Skill Workshop**（`skill_workshop`） | 对话内造/改 workspace skill（提案审批） | docs/tools/skill-workshop.md |

---

## 2. 概念映射

| Nexu 概念 | OpenClaw 落地 |
|---|---|
| 一个 Team | 1 lead/orchestrator bot + N 成员专家 bot + 1 Workboard board |
| 团队任务 | board 上一张 orchestration 父卡 + lead 主会话挂一个 **Goal**（带 token 预算） |
| 成员专家 | board 的 assignee（卡片 `card.agentId = 成员 botId`）；干活时是 worker 子 agent（`agent:<botId>:subagent:workboard-*`） |
| 任务拆解 | `workboard.cards.decompose`（父卡 → 带依赖的子卡） |
| 派活 | `workboard.cards.dispatch`（认领 ready 卡起 worker，native 每轮 ≤3） |
| 依赖编排 | 子卡 `todo` 直到父卡 `done` 才 `ready` |
| 进度追踪 | `workboard.cards.list` + `workboard_notify_*` 事件 → Nexu UI |

---

## 3. 命门约束：人设折叠进 AGENTS.md（最重要）

**事实链（已核实）**：

1. 专家人设主要在 **SOUL.md**（+IDENTITY.md）。例：`engineering-code-reviewer/expert.json` 的 `workspaceFiles` = `{SOUL.md, AGENTS.md, IDENTITY.md}`，"你是代码审查专家"在 SOUL.md；AGENTS.md 只是工作空间规范（写着"启动时读 SOUL.md 加载性格"）。
2. OpenClaw 2026.6.6 `docs/tools/subagents.md` line 643：**子 agent 上下文只注入 `AGENTS.md` + `TOOLS.md`，不注入 `SOUL.md`/`IDENTITY.md`/`USER.md`/`MEMORY.md`**。
3. ⇒ 把专家当 worker 子 agent 调起时，**SOUL.md 人设不会自动加载**——专家不成其为专家。

**修法**：编译团队成员时，把成员的 SOUL.md 人设**幂等合并进其 AGENTS.md**（唯一被子 agent 注入的人设文件）。

- 用「受管 persona 区块」做幂等合并：

  ```md
  <!-- NEXU:PERSONA:BEGIN (managed, do not edit) -->
  …SOUL.md 人设内容…
  <!-- NEXU:PERSONA:END -->
  ```
  只替换标记区块，不整文件覆盖（AGENTS.md 是 seed-if-missing 且 agent 可自改，见 [workspace-template-writer.ts](../../apps/controller/src/runtime/workspace-template-writer.ts)）。
- **截断坑**：`agents.defaults.bootstrapMaxChars` 默认 **20000**、`bootstrapTotalMaxChars` 默认 **60000**；专家 `systemPrompt` 上限 32k。长人设折叠后可能被截断——需检查并按需调高，或精简折叠内容。
- 注意：Workboard dispatch 起的 worker 同吃这条约束（worker 也是子 agent）。不折叠则 Workboard 派给"代码审查专家"的活，worker 没有该专家人设。

---

## 4. 端到端数据流

```
1. 用户在 Nexu 建 Team（选成员）
   → controller 建 lead bot + 复用/创建成员 bot + 编译 config（折叠人设、emit subagents、启用 workboard）
2. 用户给 Team 下任务
   → controller boards.upsert 建 board + cards.create 建父卡 + 给 lead 主会话 create_goal
3. lead（chat.send → lead 主会话）理解任务
   → 简单：直接答（D4）
   → 复杂：find_experts 选人 + cards.decompose 拆子卡（card.agentId=成员 botId、设依赖）
4. cards.dispatch → 认领 ready 卡 → 起 worker 子 agent（成员专家身份，依赖 §3 人设折叠）
5. worker 干活 → heartbeat / complete / block + 挂 proof / artifact
6. 依赖满足 → 子卡转 ready → 继续 dispatch（每轮 ≤3）
7. controller 订阅 workboard_notify → 推 Nexu UI（看板 + 谁在干活）
8. 全部 done → lead 汇总 → update_goal complete → 回用户
   （命中未安装成员 → lead 走 D3 A2UI 授权安装，见 §6）
```

---

## 5. 职责划分

```
┌───────────────────────────────────────────────────────────────┐
│ Lead / Orchestrator Agent（OpenClaw agent）                     │
│   控制流拥有者：拆解、派活、依赖、何时停、汇总                    │
│   能力：①原生 sessions_spawn/yield ②原生 workboard 工具          │
│         ③插件 find_experts ④插件 propose_expert_install(A2UI)    │
└──────┬───────────────────────┬───────────────────┬─────────────┘
原生委派/工作板               插件工具            原生 Goal
       ▼                       ▼                    ▼
┌──────────────┐    ┌────────────────────┐   会话目标+token预算
│ 成员专家      │    │ nexu-orchestrator  │
│ worker 子agent│    │  find_experts      │
│(人设已折叠)   │    │  propose_install   │
└──────────────┘    │ → controller HTTP  │
                    └─────────┬──────────┘
┌─────────────────────────────▼─────────────────────────────────┐
│ Workboard 引擎（RPC）：boards/cards/decompose/dispatch/notify   │
│ Controller：215 catalog + embedding 索引 + 编译 + install-flow  │
└────────────────────────────────────────────────────────────────┘
```

插件只补 OpenClaw 给不了的：**对 215 专家的硬检索** 与 **按需安装授权**。其余（委派、拆解、派发、追踪、目标、预算）全用原生。

---

## 6. 自建组件

### 6.1 `nexu-orchestrator` 插件（沿用 [nexu-a2ui](../../apps/controller/static/runtime-plugins/nexu-a2ui/) 形态）

**`find_experts`** —— 硬检索（唯一核心自建工具）：
```ts
// params
{ query: string; topK?: number; category?: string; includeUninstalled?: boolean }
// result（lead 读取）
{ experts: Array<{ slug; name; emoji; category; description; score; installed; agentId: string|null }> }
```
execute 回调 controller `/internal/experts/route`，embedding 召回在 controller。LLM 只拿 top-k，永不拿全 215。

**`propose_expert_install`** —— 安装授权卡片（D3，结构同 `render_skill_confirmation`）：
```ts
{ surfaceId; reason; experts: Array<{slug;name;emoji;description}>; pendingTask: string }
// result: A2UI surface（专家信息 + "授权安装并加入团队" / "取消"）
```
授权动作回流 → controller `install-flow` 建 Bot → `syncAll()` 折叠人设重编译 → lead `allowAgents` 热加载 → 后续 turn 委派。

不做：`delegate`（D2）、`decompose`/`synthesize`（D1，用原生 workboard/推理）、`team_note`（用 workboard 卡片 comment / worker context 替代）。

### 6.2 Controller 改动

1. **gateway-service**：封装 `workboard.*` RPC（`boards.upsert` / `cards.create` / `cards.decompose` / `cards.dispatch` / `cards.list` / notify）。通用 `wsClient.request` 已具备（[openclaw-gateway-service.ts:186](../../apps/controller/src/services/openclaw-gateway-service.ts)）。
2. **compiler**：
   - lead bot：`tools.profile:"coding"`（含 sessions_spawn/yield/subagents/workboard 工具）或 `alsoAllow`；`subagents.allowAgents:["*"]` + `maxConcurrent/maxChildrenPerAgent`；`delegationMode:"prefer"`。
   - 成员 bot：**AGENTS.md 折叠人设**（§3）；保留各自 skills。
   - `plugins.entries.workboard.enabled = true`（一次性 gateway 重启）。
3. **专家 embedding 索引**：215 manifest 编出带向量 index（落盘，仿 `compiled-openclaw.json`），catalog 变更时重算。
4. **内部检索路由** `POST /internal/experts/route { query, topK, category? }` → 召回 top-k。
5. **Team 实体**：schema（id/name/leadBotId/memberSlugs[]/boardId）+ store/ledger（仿 expert ledger）+ CRUD route。
6. **安装授权回流**：A2UI 动作 → `install-flow` → `syncAll()`。

### 6.3 Nexu UI（自建，吃 Workboard 引擎数据）

Team 列表/创建（选成员）· 任务看板（列 triage/todo/ready/running/review/done/blocked 来自 `cards.list`）· 实时"谁在干活"（notify 事件）· 卡片详情（notes/attempts/proof/artifact/worker log，card 自带）· A2UI 安装授权组件。

---

## 7. 硬护栏（native 优先，基本免费）

| 层 | 机制 |
|---|---|
| 任务级预算 | **Goal token budget** |
| 扇出/并发 | `agents.defaults.subagents.{maxConcurrent, maxChildrenPerAgent, maxSpawnDepth}` |
| 派发节流 | Workboard dispatch 每轮 ≤3 worker（native） |
| 成员工具面 | per-agent `tools.allow/deny` |
| 安全边界 | controller 检索端点限流；拒绝未授权/不存在专家 |

模型决定 WHO/WHAT，护栏强制 HOW MANY/HOW MUCH。

---

## 8. 阶段 0 Spike —— 验证结果（2026-06-18，OpenClaw 2026.6.6 实测）

> 全部 4 个核心 spike 已验证通过。S0-①/④ 用 6.6 dist 源码确认（确定性），S0-②/③ 用隔离沙箱（`--profile spike`，token auth，port 19077）实测 `gateway call workboard.*`，已清理。

| # | 结论 | 证据 |
|---|---|---|
| **S0-①** ✅ | 子 agent **只注入 AGENTS.md + TOOLS.md**，SOUL.md/IDENTITY.md 被硬过滤、无 per-agent override | `workspace-B0bmoo98.js`：`SUBAGENT_BOOTSTRAP_ALLOWLIST = new Set([AGENTS.md, TOOLS.md])`；`filterBootstrapFilesForSession` 对 `isSubagentSessionKey` 应用该 allowlist。`CRON_BOOTSTRAP_ALLOWLIST` 含 SOUL/IDENTITY/USER → 仅子 agent 被剥。`context:"fork"` 只 fork transcript 不改 bootstrap 过滤。**⟹ 人设折叠进 AGENTS.md 是必须项** |
| **S0-②** ✅ | controller 式 RPC 经 gateway 可用 | `workboard.boards.list` / `cards.create` 经 `gateway call ... --token` 成功；启用即 `9 plugins: ...workboard` 加载 |
| **S0-③** ✅ | decompose 建带依赖子卡 + dispatch 起 worker | `cards.decompose` 返回 2 子卡，各带 `metadata.links:[{type:"parent",targetCardId}]` + `agentId`；`cards.dispatch` 返回 `started:[{sessionKey, runId}]` |
| **S0-④** ✅ | `card.agentId` 绑定 worker 身份 | 源码 `buildSessionKey(card)= card.agentId ? agent:<agentId>:subagent:workboard-… : …`；实测 worker `sessionKey="agent:code-reviewer:subagent:workboard-default-<cardId>"`、`spawnedBy=agent:code-reviewer:main`。该 key 即子 agent key ⟹ 套用 S0-① allowlist |

**新发现（影响实现）**：
1. **worker 用成员 agent 自己的 agentDir 鉴权**：实测 worker 报 `ProviderAuthError: No API key ... agentDir: agents/code-reviewer/agent`（main 仅作 fallback）。⟹ Nexu 须保证每个成员 bot 有可用模型鉴权（现由 `nexu-runtime-model` 插件注入；需验证它对子 agent agentDir 生效）。
2. **dispatch 限流实测**：每轮最多 3（`DEFAULT_DISPATCH_MAX_STARTS=3`），且**同一 agent/owner 每轮只起 1 张**——两张同派 code-reviewer 的子卡只起了 1 张。⟹ 同一专家的多任务会被串行化，团队并行度取决于成员数量。
3. **依赖门控需复核**：实测中一张带 parent 依赖（父卡仍 todo）的子卡仍被 dispatch 起了 worker——与文档"子卡 todo 直到父卡 done"表述不完全一致。落地前需精确确认 ready 提升/依赖门控语义（阶段1 验证项）。
4. `workboard.cards.decompose` 入参用 `id`（非 `cardId`）；`children:[{title, agentId, ...}]`。
5. RPC 鉴权：`workboard.*` 客户端侧强制要求 operator 凭据，即使 gateway `auth=none` 也拒连——controller 调用须带 gateway token（operator scope）。

---

## 8c. 追加验证（2026-06-18，隔离沙箱 + 真实 deepseek provider）

> 沙箱复制了一份 Nexu 全局 provider（deepseek，inline key），起 2 个 agent（lead + code-reviewer），成员 workspace 写入带 `BANANA-SENTINEL-42`（end-phrase）的 AGENTS.md + 带 `SOUL-LEAK-99` 的 SOUL.md 陷阱，用 trajectory 的 `context.compiled.systemPrompt` 做权威判定。已清理（含复制的 key）。

### #3 —— 子 agent worker 能否拿到模型鉴权：✅ 能

- `nexu-runtime-model` 插件**不管鉴权**，只 hook `before_model_resolve`（选模型）+ `before_prompt_build`（加 notice）。
- Nexu 鉴权走**全局 `models.providers[].apiKey`（inline）**（编译器 `compileModelsConfig`：litellm/BYOK/link），是**顶层全局、非 agentDir 作用域** → 所有 agent 与子 agent 都能解析。
- 实测：补上全局 deepseek provider 后，dispatch 的 worker 真跑了一轮 deepseek，**0 次 ProviderAuthError**（之前报错只因首个沙箱无任何 provider、默认落到 `openai/gpt-5.5` 无 key）。
- 结论：真实 Nexu（全局 inline provider）里 worker/子 agent **自动获得模型访问**，#3 无阻断。

### 🔴 重大发现 —— Workboard `dispatch` 的 worker 拿不到成员人设

权威证据（worker 的 `context.compiled.systemPrompt`）：
- **普通子 agent**（`--session-key agent:code-reviewer:subagent:xxx`）：systemPrompt 的 `# Project Context` **列出 `ws-code-reviewer/AGENTS.md` 全文**，`Code Sentinel`/`BANANA-SENTINEL-42` **PRESENT**，`SOUL-LEAK-99` **absent**（精确符合 S0-① allowlist），回复带 `BANANA-SENTINEL-42`。**人设折叠生效，S0-① 行为坐实。**
- **Workboard dispatch 的 worker**（`agent:code-reviewer:subagent:workboard-…`）：systemPrompt 的 "Workspace Files (injected) → Project Context" **为空**，`AGENTS.md`/`Code Sentinel`/`BANANA-SENTINEL-42` **全部 absent**；worker 被 worker-protocol（claim/heartbeat/complete）主导，回复 `2 plus 2 equals 4.`，**不带人设短语**。

⟹ **结论：不能用 Workboard 的 `dispatch` 来"执行"专家 worker**——它派的 worker 不注入成员 AGENTS.md，人设折叠对它无效。

### 人设缺口可修 → 保留 dispatcher（D5 二次修正）

不必放弃 dispatcher。它有 `sessions_spawn` 替代不了的独有优势：**代码驱动的持久调度循环**（tick/CLI 推进，不依赖 lead 在线烧 token）、**依赖 DAG 门控**（子卡等父卡 done 自动 ready）、**崩溃恢复**（卡片落 SQLite，claim/heartbeat/complete/block、stale 清理、超时 block、attempt/retry；gateway 重启续跑——而 sessions_spawn 完成是 best-effort，重启即丢）、**幂等 worker lane**、**现成运维面**（CLI/dashboard/诊断/proof/artifact）。

人设缺口的修法在我们掌控的数据面：
- 源码：`buildWorkerPrompt` 末尾拼 `params.context = buildWorkerContext(card)`，而 `buildWorkerContext` 含 `if (card.notes) lines.push("## Notes", capText(card.notes, 4000))`。
- ⟹ **建卡时把成员人设写进 `card.notes`（≤4KB）**，dispatcher worker 即在 prompt 里拿到人设。
- 行为佐证（已专项验证 2026-06-18）：成员 AGENTS.md **置空人设**，仅在 `card.notes` 放一个"海盗腔 + 结尾必带 `YARR-REVIEW-COMPLETE-7`"的人设；dispatch 的 worker：①user prompt 里**含该人设全文**（`card.notes`→`buildWorkerContext`→`buildWorkerPrompt` 链路坐实）；②回复 *"Arr… 2 plus 2, ye scallywag?…"* 且结尾带 `YARR-REVIEW-COMPLETE-7`——海盗腔 ✅ + 结尾标记 ✅。因 AGENTS.md 无人设，行为只能来自 notes，**归因干净，persona-in-notes 行为坐实**。

**最终 D5**：
- **执行用 Workboard dispatcher**（保留其调度/依赖/恢复优势）。
- **人设经 `card.notes` 注入**：controller/lead 建成员卡时，把该成员人设块写进 notes（持久 persona 区块）。人设以"任务上下文"层级到达（与 worker-protocol 同级），够用。
- `sessions_spawn` + AGENTS.md 折叠路径**保留为备选**（若某场景需 system-prompt 级人设，或不走看板的轻量编排）。
- 代价：人设非 system-prompt 级（任务上下文级）；每卡带一份人设（~600 字符，4KB 预算内）；弱模型遵从度与 AGENTS.md 同级。

**阶段1 验证项**：~~① `card.notes` 注入人设的 worker 行为遵从度~~ **已确认（见上）**；② 根因（worker 为何 Project Context 为空）可顺带定位 `subagent.run` 的 bootstrap/context 选项，若有受支持的 full-bootstrap 开关则更优（system-prompt 级人设，遵从度更高、不占 4KB notes 预算）。

---

## 8b. 阶段 0 Spike —— 原始可执行验证步骤（留存）

> 全部在 `pnpm dev start` 起的本地栈上做。手动起 OpenClaw 时给 `@nexu/controller` 设 `RUNTIME_MANAGE_OPENCLAW_PROCESS=false`。本地优先用 `./openclaw-wrapper` 而非全局 `openclaw`。改 runtime-plugins/agent 配置后按「先 controller 后 openclaw」重启（restart openclaw 偶发首次失败需重试）。

### S0-① 人设折叠 → worker 子 agent 人设生效（最高优先）

1. 取一个已安装专家（如 code-reviewer），手动在其 workspace `agents/<botId>/AGENTS.md` 内用 `<!-- NEXU:PERSONA:BEGIN/END -->` 区块粘入其 SOUL.md 全文。
2. 配一个 lead agent，`subagents.allowAgents` 含该 botId，`tools.profile:"coding"`。
3. 从 lead 主会话发任务，让其 `sessions_spawn({ agentId:<botId>, task:"自我介绍你的专长与工作风格" })` + `sessions_yield`。
4. `./openclaw-wrapper`（或 `/subagents log <id>`）查看 worker 回复。
- **通过**：worker 自我介绍带专家人设（专长/语气/开场白）。
- **不通过**：人设缺失 → 检查 AGENTS.md 是否被 `bootstrapMaxChars`(20000) 截断；调高或精简折叠内容；仍不行则评估 runtime-patch 让子 agent 注入 SOUL.md。

### S0-② controller 调 `workboard.*` RPC 跑通

1. 编译 config 写入 `plugins.entries.workboard.enabled=true`，重启 gateway。`./openclaw-wrapper plugins inspect workboard --runtime --json` 确认已启用。
2. 从 controller（或临时脚本走 `wsClient.request`）依次调 `workboard.boards.upsert` → `workboard.cards.create` → `workboard.cards.list`。
- **通过**：board/card 创建成功，list 能读回。
- **不通过**：检查 RPC 权限（mutating 需 `operator.write`/`admin`）与 gateway token。

### S0-③ decompose + dispatch 起 worker

1. 建一张父卡（orchestration），`workboard.cards.decompose` 拆成 2 子卡，每张设 `agentId=成员 botId` + 依赖父卡。
2. `workboard.cards.dispatch`。
3. 观察是否起 worker 子 agent、子卡状态流转（ready→running→review/done）。
- **通过**：worker 起来、按依赖顺序执行、卡片生命周期同步。
- **不通过**：确认有 ≥1 张 `ready` 无活跃 claim 的卡；gateway 在线（否则只 data-only dispatch 不起 worker）。

### S0-④ assignee → worker agentId 映射

1. 在 S0-③ 基础上确认 worker 会话键形如 `agent:<成员botId>:subagent:workboard-*`，且该 worker 实际加载了成员 agent（叠加 S0-① 的折叠人设）。
- **预期**（已静态确认 card 带 `card.agentId` 字段，dispatch 按其定 worker agent）：设 `card.agentId=成员botId` 即可让 worker 以该专家身份跑。
- **不通过**：worker 落到默认 agent → 排查 decompose/create 时 `agentId` 是否正确写入卡片。

### S0-⑤（可选）notify 事件可订阅

- 调 `workboard_notify_subscribe` / `notify_events` / `notify_advance`，确认 controller 能增量拉卡片事件喂 UI。不通过 → 退路：轮询 `workboard.cards.list`。

---

## 9. 分阶段交付

- **阶段 0**：S0-①~⑤ 出结论（①②③④ 是动手前硬门槛）。
- **阶段 1**：Team CRUD + 编译接线（折叠人设 / emit subagents / 启用 workboard）+ lead 手动拆解派发跑通（成员手选，无 find_experts）。
- **阶段 2**：`find_experts` 自动选人 + `propose_expert_install` 命中未装授权安装。
- **阶段 3**：Nexu 看板 UI + 实时事件 + Goal 汇总。
- **阶段 4（可选）**：Task Flow 做可复现「团队 Playbook」；Skill Workshop 做成员自我造技能。

---

## 10. 未决问题 / 风险

1. 人设折叠是否足够还原专家 + AGENTS.md 截断（S0-①）。
2. 启用 workboard 的一次性重启与现有 hot-reload 策略相容性（[2026-04-14-openclaw-registry-cache-invalidation.md](2026-04-14-openclaw-registry-cache-invalidation.md)）。
3. Workboard 自述「intentionally small / Gateway-local / 每轮≤3 worker」——多 Team、跨设备规模上限。
4. 安装授权后 `allowAgents`（或 `["*"]`）热加载是否即时可委派。
5. 多成员并行的成本上限与用户可见预算提示（接 Goal token budget）。

---

## 11. 附：想法1（自动调度单专家）若日后做

主路径不是子 agent，而是**把整段对话路由到该专家主会话**（`agent:<expertBotId>:main`，SOUL.md 人设完整加载）——controller 侧路由：embedding 选专家后切换会话目标。一轮内只有一个专家；若要「一轮内多专家混合」，则落到本文件的子 agent + 人设折叠路径。

---

## 关联

- 专家模型：[expert.ts](../../packages/shared/src/schemas/expert.ts)、[experthub/](../../apps/controller/src/services/experthub/)
- 配置编译：[openclaw-config-compiler.ts](../../apps/controller/src/lib/openclaw-config-compiler.ts)
- 人设文件写入：[workspace-template-writer.ts](../../apps/controller/src/runtime/workspace-template-writer.ts)、[install-flow.ts](../../apps/controller/src/services/experthub/install-flow.ts)
- gateway RPC：[openclaw-gateway-service.ts](../../apps/controller/src/services/openclaw-gateway-service.ts)
- A2UI 范式：[nexu-a2ui/index.js](../../apps/controller/static/runtime-plugins/nexu-a2ui/index.js)（`render_skill_confirmation`）
- OpenClaw 6.6 docs：`docs/tools/subagents.md`、`docs/plugins/workboard.md`、`docs/tools/goal.md`、`docs/concepts/parallel-specialist-lanes.md`、`docs/automation/taskflow.md`
- registry restart 规则：[2026-04-14-openclaw-registry-cache-invalidation.md](2026-04-14-openclaw-registry-cache-invalidation.md)
</content>
</invoke>
