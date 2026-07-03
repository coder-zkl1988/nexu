# 团队工作流增强：可复现 SOP + 自动组队 + 运行视图（借鉴 Agency Orchestrator）

> 创建：2026-07-01
> 关联：[2026-06-15-nexu-orchestrator-plugin.md](./2026-06-15-nexu-orchestrator-plugin.md)（Teams/Workboard 底座）、[2026-06-30-in-chat-expert-auto-route.md](./2026-06-30-in-chat-expert-auto-route.md)（对话内 auto-route）
> 参考来源：`~/workspace/agency-orchestrator`（线上 https://ao.aiolaola.com/studio）

## 0. 结论

参考项目 **Agency Orchestrator（AO）** 是一个本地优先的 CLI + Web Studio，把 216 个 AI 角色编排成**声明式 YAML 工作流**。它和我们 `feat/nexu-teams` 的关系有三个关键事实：

1. **角色同源。** AO 的角色来自 `agency-agents-zh`，和我们「AI·小伙伴」专家**同一份源**（slug 对得上：`academic-historian`、`marketing-xiaohongshu-operator`…）。人设是共享的。
2. **引擎我们已有且更强。** AO 是内存里的 DAG runner（无状态、单次 LLM 调用每步）。我们的 Teams 骑在 OpenClaw **Workboard** 上（`cards.decompose` 拆依赖卡 → `cards.dispatch` 起 worker 子 agent，SQLite 落盘 + 崩溃恢复 + 依赖门控）。**不需要引第二个引擎。**
3. **AO 补的正是我们缺的"计划层"。** D1（[orchestrator 文档](./2026-06-15-nexu-orchestrator-plugin.md) §0）锁定「控制流归 LLM（agentic），不写死 DAG」。AO 是反面：**固定、可复用、可复现的声明式计划**。这不是替换 agentic，而是**新增一种计划模式**——给可重复产出的任务用。

因此本文把「值得借鉴的 P1–P5」全部细化为**骑现有 Workboard 引擎**的增强方案。一句话原则：**借模型、不耦合系统**——把 AO 的 DAG/compose/SOP/运行视图**思想**搬进我们的 controller + Workboard + A2UI，而不是把两套系统绑一起。

---

## 1. 现状对照（我们已有 vs. 缺口）

| 能力 | 现状（`feat/nexu-teams`） | 代码位置 | AO 对应 | 缺口 |
|---|---|---|---|---|
| 执行引擎 | Workboard：decompose + dispatch + 依赖门控 + 崩溃恢复 | `openclaw-gateway-service.ts:227-267`（`workboard*` RPC） | 内存 DAG runner | 我们更强，无缺口 |
| 任务拆解 | Phase 1 手工 `subtasks[]`；Phase 2 `TeamPlanner.planSubtasks` agentic | `team-service.ts:253-300`、`team-planner.ts` | `compose` LLM meta-prompt | **planner 无幻觉/变量修复；无可复用模板** |
| 子卡结构 | **扁平 fan-out**：children=`{title, agentId, notes}`，都挂父卡 | `team-service.ts:342-358` | DAG：`depends_on` + `{{var}}` 串联 | **无步骤间依赖、无上下文传递** |
| 人设注入 | `card.notes`（≤4KB）→ `buildWorkerContext` → worker prompt | orchestrator 文档 §8c | 角色 .md body = system prompt | 对齐（worker 不读 AGENTS.md） |
| 运行视图 | Phase 3 Kanban：`cards.list` + notify 事件 | `team.ts` `teamBoardResponseSchema` | 逐步流式 + 进度条 + 双视图 + 导出 | **无步骤点亮 / 无导出 / 无单步重跑入口** |
| 控制流 | 无（agentic 自由发挥） | — | `loop` / `approval` / `human_input` / `condition` | **无显式控制流** |
| 组队 | 手动选成员；auto-route 选**单个**专家 | `teams.tsx`、find-expert 插件 | 一句话自动组**整队** | **无"一句话自动组队"** |

**核心缺口一句话：** 我们有强执行引擎 + agentic 计划，但缺 ①**步骤间依赖 + 变量传递**、②**可复用 SOP 模板**、③**高质量自动组队（带修复）**、④**结构化运行视图 + 控制流**。P1–P5 逐一补上。

---

## 2. 与 D1（agentic 优先）的关系——不冲突，是并存

D1 说「不写死编排 DAG」，指的是**不把引擎的控制流硬编码**。本文的 SOP 是**用户/模型产出的、可保存复用的计划数据**，不是引擎硬编码。两种模式并存、同一个 Workboard 引擎执行：

| 模式 | 计划来源 | 适用 | 触发 |
|---|---|---|---|
| **Agentic（默认，现状）** | lead 每次实时推理 | 探索性、一次性、对话式 | `autoRunTeamTask` / 对话内 |
| **SOP（新增，本文 P1）** | 保存的声明式模板 | 可重复、要一致性/可复现的产出 | 选模板运行 |
| **Compose（本文 P2）** | 一句话 → LLM 生成计划（可另存为 SOP） | 不知道怎么拆时的冷启动 | "一句话自动组队" |

SOP 与 Compose 都**编译成同一个 `workboard.cards.decompose` 调用**，复用现有 dispatch / 依赖门控 / 人设注入 / 崩溃恢复。

---

## 3. P1 — 声明式可复用 Team Workflow / SOP（地基，最大收益）

### 3.1 借鉴点
AO 的 workflow 是声明式 YAML：`inputs`（带类型/默认值）+ `steps`（每步 `id` / `role` / `task`（`{{var}}` 模板）/ `output`（变量名）/ `depends_on`（DAG））+ `concurrency`。上游 `output` 写进 context，下游 `task` 用 `{{output}}` 引用。详见 AO `src/core/executor.ts`（context Map + 模板渲染）。

### 3.2 嫁接到 Workboard（不是新引擎）
一个保存的 `TeamWorkflow` 数据，**编译**成现有 `dispatchSubtasks` → `workboardCardDecompose` 调用：

```
TeamWorkflow.steps[]  ──编译──▶  workboard children[]
  step.assigneeSlug   ───────▶    child.agentId = member.botId
  人设(persona)        ───────▶    child.notes（已有，team-service.ts:350）
  step.task(渲染后)    ───────▶    child.notes 追加「任务」段
  step.dependsOn[]    ───────▶    child 依赖链（Workboard sibling 依赖，见 §3.4 ⚠️）
  step.output + {{var}} ─────▶    完成→注入：上游卡 done 后把产出渲染进下游卡 notes（见 §3.4）
```

### 3.3 Schema 草图（`packages/shared/src/schemas/team-workflow.ts`，新增）

```ts
export const workflowInputSchema = z.object({
  name: z.string().min(1).max(40),          // 变量名（snake_case）
  description: z.string().max(200).optional(),
  required: z.boolean().default(false),
  default: z.string().optional(),
});

export const workflowStepSchema = z.object({
  id: z.string().min(1).max(40),            // 步骤 id（DAG 节点）
  assigneeSlug: z.string().min(1),          // 成员专家 slug（对标 AO role）
  name: z.string().max(40).optional(),      // 显示名（如「选题导师」）
  emoji: z.string().max(8).optional(),
  task: z.string().min(1).max(8_000),       // {{var}} 模板，渲染后进 card.notes
  output: z.string().max(40).optional(),    // 产出变量名（写回 context）
  dependsOn: z.array(z.string()).max(20).default([]),
  type: z.enum(["normal", "approval", "human_input"]).default("normal"), // P3 控制流
  // P3：自我修正循环（review→fix 直到 exitCondition）
  loop: z.object({
    backTo: z.string(), maxIterations: z.number().int().min(1).max(5),
    exitCondition: z.string(),              // 如 "{{review}} contains APPROVED"
  }).optional(),
});

export const teamWorkflowSchema = z.object({
  id: z.string(), teamId: z.string(),
  name: z.string().min(1).max(80),
  description: z.string().max(280).optional(),
  inputs: z.array(workflowInputSchema).max(10).default([]),
  steps: z.array(workflowStepSchema).min(1).max(20),
  source: z.enum(["builtin", "composed", "user"]).default("user"),
  createdAt: z.string(), updatedAt: z.string(),
});
```

存储：controller state（沿用 teams 的存储层），**不**落 YAML 文件（YAML 仅作导入/导出格式，见 P4）。编译期校验：DFS 防环（对标 AO `parser.ts:232`）、`{{var}}` 必须来自 `inputs` 或上游 `output`、`assigneeSlug` ∈ 团队成员、`dependsOn` 引用存在。

### 3.4 两个关键补强（现状没有，必须 spike 先验证）
- **⚠️ S1 步骤间依赖。** 现状 children 是扁平 fan-out（都挂父卡）。SOP 的 `dependsOn` 要落成 **Workboard sibling 卡依赖**（卡 B 等卡 A `done` 才 `ready`）。需验证 Workboard `cards.decompose` 的 `children[].metadata.links` 是否支持 `type:"dep", targetCardId:<siblingCardId>`（不只是 `parent`）。若不支持，退路：controller 在 notify 上手动门控（A done → promote B）。
- **⚠️ S2 变量/上下文传递。** AO 的 `{{var}}` 要落成：卡 A 的 worker 完成 → controller 在 `workboard_notify_*`（card done）事件上读卡 A 产出（`proof`/`artifact`/worker 结果，`cards.list` 已含）→ 渲染进卡 B 的 `task`（`{{output_of_A}}`）→ 写回卡 B `notes` → 再 promote 卡 B 到 ready。这是把 AO 的内存 context Map 换成「卡产出→下游卡 notes」的注入循环。controller 已监听 notify（Phase 3），扩成「完成→注入→推进」。

### 3.5 复用 / 新增 / 工作量
- **复用：** `dispatchSubtasks`、`workboardCardDecompose`、人设 notes 注入、dispatch 多趟循环（`team-service.ts:316-369`）、notify 监听。
- **新增：** `team-workflow.ts` schema + 编译器（steps→children + 依赖 + 渲染）+ 上下文注入循环 + CRUD 路由（`createRoute()`+`app.openapi()`）+ `pnpm generate-types`。
- **工作量：中。** 风险集中在 S1/S2（spike 先行）。

---

## 4. P2 — 一句话自动组队 + 自动出 SOP（升级 TeamPlanner）

### 4.1 借鉴点
AO 的 `compose`（`src/cli/compose.ts`）是 **LLM 驱动**：一段 ~180 行 meta-prompt 让模型从全角色目录①选 2–6 个最专业角色 ②设计 DAG（并行优先）③写每步 task ④`{{var}}` 串联 ⑤最后一步只输出干净成品。两种模式：
- `pinnedRoles=[]` → **AI 全目录自动挑人**（Studio「AI 自动组队」，`web/server.js:690`）。
- `pinnedRoles=[…]` → **锁定阵容**，只在选定角色间设计分工。

**命门——修复层（必须移植）：** LLM 生成的编排很脆，AO 花大量代码修复：
- **角色路径幻觉**（`compose.ts:446-507`）：Levenshtein + 子串最近匹配 → 不行再 LLM 重试。
- **变量引用错误**（`compose.ts:546-582`）：DAG 闭包内最近匹配 → 不行再 LLM 二次修复。

### 4.2 嫁接到我们的栈
nexu 已有 `TeamPlanner.planSubtasks`（Phase 2，`team-service.ts:289`）。升级为 AO 式 compose：
1. **候选角色：** 复用 find-expert 插件的 `loadCatalog` + `scoreExpert`（`static/runtime-plugins/find-expert/index.js`）先做语义召回，再把候选目录喂给 meta-prompt（缩小幻觉面）。
2. **生成计划：** lead model 产出 `{members[], steps[]（带 dependsOn + {{var}}）}`（直接产出 P1 的 `TeamWorkflow` 结构）。
3. **🔴 移植修复层：** 角色 slug 幻觉 → 最近匹配**我们 catalog 的 slug**；未定义变量 → DAG 闭包修复。**这是 P2 的重点工作量**，不做则编排经常跑挂。
4. **用户确认：** 把生成的「成员 + 步骤」用 **A2UI 卡片**（复用我们刚做的 `ExpertInstallCard` 模式 + `onAction` 回传链路）呈现，允许增删成员 / 改步骤 / 微调，再跑。未安装成员 → 触发安装授权卡（已有）。
5. **可另存为 SOP**（喂给 P1 复用）。

两种模式同 AO：空选=全目录挑人；预选=锁定成员、只设计步骤分工（对接现有「建队选成员」UI）。

### 4.3 工作量 / 风险
- **工作量：中–大**（修复层是重点）。
- **风险：** LLM 编排质量 + 修复覆盖率。缓解：候选先召回缩面 + 修复层 + A2UI 人确认兜底。

---

## 5. P3 — 结构化运行视图 + 控制流（升级 Kanban + 引擎能力）

### 5.1 运行视图（借鉴 AO Studio 运行面板）
AO：步骤 chips 进度条（pending→running→done）+ 每步流式输出 + 结果/终端双视图 + 「最终交付」卡 + 单步重跑 + resume。
嫁接：
- nexu 已有 Phase 3 `teamBoard`（`cards.list` + notify）。增强为「**步骤逐个点亮**」：卡状态 `triage/todo/ready/running/review/done/blocked` ↔ 步骤进度;卡自带 `notes/attempts/proof/artifact/worker log` → 展开看每步产出（对标 AO 结果视图）。
- **最终交付/导出：** 把 board 各卡产出按 SOP 顺序汇总成 markdown（再可 → docx/xlsx，对标 AO `reporter.ts` + `--export`）。
- **单步重跑：** 重置某卡回 `ready` 重新 dispatch（Workboard 已支持 attempt/retry）。
- **resume：** Workboard 已 SQLite 落盘 + 崩溃恢复，天然 resume（比 AO 的 metadata.json resume 更强）。

### 5.2 控制流（借鉴 AO `type`/`loop`/`condition`）
- **`approval` / `human_input` 闸口：** 步骤 `type=approval|human_input` → controller 在该卡 dispatch 前置为 `blocked` + 发 **A2UI 确认/输入卡**到对话（复用安装卡同款 `onAction` 回传）→ 用户操作写回 → promote 到 ready。对标 AO 的 `await-input`（SSE→stdin），但我们用 A2UI 而非 stdin。
- **`loop`（自我修正）：** review 卡产出含 `APPROVED` → done；否则回 fix 卡重做（≤N 次）。用 Workboard `review`/`block` 状态 + controller 在 notify 上判 `exitCondition` + 重建 fix→review 卡。对标 AO `executor.ts:202-264` 的 `back_to`+`exit_condition`。
- **`condition`：** 步骤可带条件，controller 在 promote 前对上游产出求值决定 skip（对标 AO `condition`）。

### 5.3 工作量
- 运行视图（步骤点亮 + 导出）：**中**（吃现有 board 数据，主要前端）。
- 控制流（loop/approval/condition）：**中**，loop 与 approval 需 spike（S3）。

---

## 6. P4 — SOP 模板库（starter 工作流）

### 6.1 借鉴点
AO 自带 ~30 个领域 workflow（`workflows/`：小红书爆款、技术博客、学术论文、投资分析、软件开发标准流程、产品评审…）。

### 6.2 嫁接
因**角色同源**，AO 模板可机械转成我们的 `TeamWorkflow`（P1 schema）：
- `role` 路径（`marketing/marketing-xiaohongshu-operator`）→ 我们 expert slug（`marketing-xiaohongshu-operator`）的**映射表**。
- `depends_on` / `{{var}}` / `task` 文案**直接搬**。
- 内置为「创建小分队 / 选模板运行」时的 starter SOP（`source:"builtin"`）。
- 模板引用的 expert 未装 → 复用安装授权卡**批量装**。

### 6.3 工作量 / 价值
- **工作量：小**（映射表 + 一次性转换脚本 + 编译期校验）。
- **风险：低**（手写模板无 LLM 幻觉）。**价值：高感知**（开箱即用的"几分钟出方案"）。

---

## 7. P5 — 可视化画布（暂缓，给草图）

### 7.1 借鉴点
AO Studio 的拖拽连线 DAG 编辑器（`/api/workflows/graph`）：拖节点 / 连线（自动防环）/ 改任务·角色 / 保存，运行时节点按状态点亮。

### 7.2 嫁接草图（优先级最低，P1–P3 稳后再做）
- 在 P1 的 `TeamWorkflow` 之上做一个 React Flow 式画布：**节点 = step**（显示 assignee emoji/name）、**边 = dependsOn**、防环复用 P1 编译期 DFS 校验。
- 运行时节点状态**吃 `teamBoard` 的卡状态**（P3 已有数据）→ 点亮。
- 编辑 = 改 `TeamWorkflow` 并 `PATCH` 保存。

### 7.3 工作量
- **大**（画布编辑器 + 双向绑定）。**最低优先级**。

---

## 8. 不照搬的边界（明确不做）

- **不替换 agentic（D1）。** SOP 是新增的「可复现」模式，agentic（lead 自由编排）仍是默认。
- **不引第二个执行引擎。** 全部 P 骑现有 Workboard——依赖门控 + 崩溃恢复 + 持久调度比 AO 内存 DAG 更强。
- **不把"步骤"降级成无状态单次 LLM 调用。** 步骤执行器仍是 Workboard worker 子 agent（带工具/多轮）。AO 的步骤是单次 `chat()`，我们更强，别降级。
- **不照搬 YAML-落盘作者体验。** SOP 存 controller state（Zod，type-safe）；YAML 仅作导入/导出（吃 AO 模板用）。
- **不照搬多模型 / CLI-子进程编排。** 单一 OpenClaw 运行时，更简单。
- **不耦合两套系统。** AO 的 `openclaw-cli` 连接器说明它能调 OpenClaw，但我们**借模型不绑系统**。

---

## 9. 分阶段路线

| 阶段 | 内容 | 依赖 | 产出 | 状态 |
|---|---|---|---|---|
| **0 Spike** | S1 sibling 依赖 / S2 完成→注入 / S3 approval 闸口（§10） | — | go/no-go + 落地方式 | ✅ 2026-07-01 全过（§10.1–10.4） |
| **A（P1 后端）** | `TeamWorkflow` schema + 校验（防环/变量来源/成员归属）+ Workboard 编译（decompose + linkDependency）+ controller 驱动执行（chat.send lane + 轮询会话状态 + 产出注入下游）+ CRUD/run 路由 + SDK | S1/S2 | 可保存/复用的 SOP | ✅ 2026-07-02 落地并真机 E2E（见下） |
| **A'（P4 模板）** | 3 个 starter SOP 模板 + 列表/实例化端点 | A | starter SOP | ✅ 2026-07-02 落地并真机 E2E（见下） |
| **B（P2）** | compose 端点（lead 经 agent-turn 生成草稿）+ 修复层 + UI 确认后保存 | A | 一句话自动组队 | ✅ 2026-07-02 落地并真机 E2E（见下） |
| **C（P3）** | 运行视图（DAG 点亮 + 产出详情）+ approval 闸口 + 导出 Markdown + workflow UI | A | 结构化运行 + 控制流 | ✅ 2026-07-02 落地（approval 真机 E2E；loop/condition 未做，见下） |
| **D（P5）** | 可视化画布 | A,C | DAG 画布 | ✅ 只读画布 + 状态点亮（拖拽编辑决定不做，表单编辑够用） |

**阶段 B/C/D 落地记录（2026-07-02）：**
- **B（compose）**：`team-workflow-composer.ts` —— lead 经网关 OpenAI 兼容端点生成草稿（⚠️ 该端点只接受 `openclaw/<agentId>`、跑完整 agent turn，且 system 消息会被 agent 人设稀释——指令必须全放 user 消息；**现有 TeamPlanner 传裸模型名的路径同样失效，已于 2026-07-02 修复**：`planSubtasks` 改为 `agentId: team.leadBotId` + `openclaw/${agentId}`、指令折叠进单条 user 消息，`team-service.ts`/`container.ts` 联动调整，真机 `POST /run-auto` 复测通过）。修复层：JSON 提取/规整、专家 slug 模糊修复（子串+Levenshtein）、`{{var}}` 近似修复、缺失 dependsOn 自动补边、结构校验兜底。端点 `POST /{id}/workflows/compose` 返回草稿（不落库），UI 预览（含修复警告）确认后经 `POST /workflows` 保存——保存路径现在会自动补齐缺失成员（compose 草稿可引用全目录专家）。
- **C（approval + 运行视图 + 导出）**：step 新增 `type:"approval"`（不许有 output）；运行到审批步时卡片 `blocked`（原因 awaiting approval）、run 在内存暂停（**controller 重启则丢run——v1 限制，卡片状态仍在板上**）；`GET /{id}/workflow-approvals` 列表 + approve 端点放行。前端 `TeamWorkflows` 组件（团队详情页）：工作流列表/模板选择/compose 对话框/输入表单运行/审批横幅一键批准/导出 Markdown（按步骤拼卡片产出）。board 卡片新增 `output` 字段（取**第一条** comment——回复先写、完成摘要后写；曾用"最长评论"启发式被 E2E 抓出选错，已修）。loop / condition **未做**（approval 是 S3 验证过的最高价值闸口；loop/condition 留待有真实需求再加）。
- **D（画布）**：`WorkflowDagCanvas` 手写 SVG（不引新依赖）——拓扑 wave 列布局、依赖贝塞尔连线、节点状态点亮（running 脉冲/done 绿/blocked 琥珀）、点击看步骤产出。**拖拽编辑决定不做**：表单/模板/compose 三条创建路径已覆盖，手写拖拽编辑器成本远超价值（React Flow 属新依赖，未获批准）。
- **真机 E2E**：compose 一句话 → lead 生成两步 DAG（零修复警告）→ 保存自动补员；审批门工作流 produce→gate(approval)→publish：run 在 gate 暂停（approvals 列表可见渲染后的审批提示词含上游产出）→ API 批准 → 续跑 → publish 精确回显跨闸口线程化的 token。测试数据全清理，专家安装集回基线。

**阶段 A 落地记录（2026-07-02）：**
- 代码：`packages/shared/src/schemas/team-workflow.ts`（Zod schema + SDK 类型）、`apps/controller/src/services/teams/team-workflow-{service,ledger}.ts`、`subagent-session-reader.ts`、`apps/controller/src/routes/team-workflow-routes.ts`、gateway 新增 `linkDependency/update/comment/complete/block` RPC 封装；团队删除级联清 workflows。
- 执行语义（§10.3/§10.4 设计照落）：run 端点立即返回（board+父卡+每步一张 gated 卡），后台按拓扑 wave 执行——渲染 `{{var}}` → 写卡 notes → `chat.send` 到 `agent:<botId>:subagent:wf-<runId>-<stepId>` lane → 轮询 `sessions.json` 到 `done` → 从 transcript 读回复 → 记 comment + `cards.complete` → 产出入 context 供下游。失败/超时 → 阻塞该卡 + 下游 + 父卡。进度经现有 `GET /teams/{id}/board` 观测。
- 测试：19 个单测（校验 9 项/拓扑/模板/CRUD/执行线程化/失败阻断）；controller 全套 50 文件全过。
- 真机 E2E：真实 API 建队建流跑流，两步 token 接力 ~15s 全部 `done`——输入渲染（`{{topic}}`）、依赖门控（回显等产出）、产出线程化（`{{brief}}` 注入下游 notes 且下游回显成功）全部实证。

**阶段 A' 落地记录（2026-07-02）：**
- 3 个 starter 模板（`team-workflow-templates.ts`，task 文案自写、DAG 结构对标验证过的多智能体工作流形态）：小红书爆款笔记（4 步菱形：策略 → 正文∥标题标签 → 整合）、技术博客创作（调研 → 大纲 → 初稿 → 润色）、学术论文选题与大纲（评估 → 方法论∥文献 → 大纲）。assignee slug 全部对应 experthub 目录（单测守护自校验）。
- 端点：`GET /api/v1/team-workflow-templates`（列表）+ `POST /api/v1/teams/{id}/workflows/from-template`（一键实例化：缺的专家经 `ensureTeamMembers` 自动补进团队并自动安装，workflow 以 `source:"builtin"` 落库）。
- 真机 E2E：只含 1 个所需专家的团队实例化小红书模板 → 成员自动 1→3（2 个专家自动安装）→ 跑真实主题——**并行 wave 实证**（正文与标题标签同时 `running`）、整合步骤等两路都完成才启动，~2 分钟产出【标题】/【正文】/【话题标签】/【发布建议】四段齐全的可发布成稿。测试团队/看板/新装专家全部清理回基线。

---

## 10. 阶段 0 Spike（先验证再写，对标 orchestrator 文档的 spike 习惯）

| # | 验证 | 方法 | 决定 |
|---|---|---|---|
| **S1** | Workboard 是否支持 **sibling 卡依赖**（卡 B 等卡 A done 才 ready），还是只有 parent-child？ | 读 `docs/plugins/workboard.md`；实测 `cards.decompose` children 设 `metadata.links:[{type:"dep",targetCardId:<sibling>}]` 后看门控 | 决定 P1 依赖落法（引擎原生 vs controller 手动门控） |
| **S2** | controller 能否在 card-done **notify 事件**上读卡 A 产出、渲染进卡 B notes、再 promote？ | 两步流：A 产 `{{x}}`，B task 含 `{{x}}`；监听 notify → 注入 → ready；看 B 是否拿到 A 的产出 | 决定变量传递可行性（P1 命门） |
| **S3** | approval 闸口：卡 `block` → A2UI 确认卡 → `onAction` 回写 → promote 跑通？ | 复用安装卡链路，一个 approval 步骤 | 决定 P3 控制流落法 |

S1+S2 任一不通 → P1 降级为「controller 侧门控 + 注入」（不依赖 Workboard 原生 sibling 依赖），仍可成立，只是门控逻辑在 controller。

### 10.1 Spike 结果（2026-07-01，dev runtime 经 gateway RPC 实测，全部 ✅）

三个门槛**全部跑通**，且比预期更省——P1 **不需要自建 DAG runner**，直接骑 Workboard 原生依赖门控。

| # | 结果 | 实测要点 |
|---|---|---|
| **S1** ✅ | sibling 依赖**原生门控** | `linkDependency({parentId:A, childId:B})` 让 B 依赖 A。A 仅 `ready`（未 done）时 `promote` B 被拒、B 停在 `todo`；A `done` 后 `promote` B → `ready`。编排父卡**不**阻塞（A 照常 promote）。卡落 SQLite ⟹ 比 AO 内存 DAG 更强（崩溃可续）。 |
| **S2** ✅ | 完成事件 + 产出**可读可注入** | 卡完成触发 `completed` 通知事件（`workboard.notifications.events {boardId}` 收到 `["completed"]`）⟹ controller 可事件驱动。上游产出落在 `metadata.comments[].body`（完成 summary 也在卡上）⟹ 可读。`cards.update({id:B, notes})` 把上游产出注入下游卡 ⟹ 可传值。 |
| **S3** ✅ | approval **闸口** | `cards.block({id})` → 状态 `blocked`（卡住步骤）；`cards.unblock({id})` → 回 `todo`（放行）。A2UI 确认回传驱动 unblock（复用安装卡 `onAction` 链路）。 |

**验证后的 RPC 原语映射（P1/P3 直接用）：**

| 设计概念 | Workboard RPC | 备注 |
|---|---|---|
| `step.dependsOn[]` | `workboard.cards.linkDependency({parentId:<上游卡>, childId:<下游卡>})` | 原生门控，上游 `done` 前下游不 `ready` |
| 步骤执行 | `workboard.cards.decompose`（建卡）+ `cards.dispatch`（起 worker） | 已有（`team-service.ts`） |
| 完成事件触发 | `workboard.notifications.subscribe` + `notifications.events` | 事件驱动注入（subscribe 入参待校准，events 按 `boardId` 可用） |
| 读上游产出 | `cards.list` → `card.metadata.comments[].body` / `proof` / summary | worker 产出落点 |
| `{{var}}` 注入 | `workboard.cards.update({id:<下游卡>, notes})` | 渲染后写下游 `notes` |
| `type:"approval"` 闸口 | `cards.block` ↔ `cards.unblock`（A2UI 驱动） | |

**结论：P1 GO。** 依赖门控 + 传值 + 闸口三件套**全部有原生 RPC 支撑**，controller 只需「编译 SOP → `decompose` + `linkDependency`；监听 `completed` → 读产出 → `update` 下游 `notes` → 放行」，**无需自建引擎**。这也直接给 P3 的 `loop`/`approval`/`condition` 提供了原语（block/unblock + 事件 + update）。

> Spike 脚本（一次性，未入库）：`scratchpad/wb-spike-{s1,s2,s3}.mjs`。测试用 board（`spike-*`）已清理。

### 10.2 真 worker 端到端（E2E）—— 暴露一个共性阻塞（非 P1 设计问题，⚠️ 首次诊断有误，见 §10.4 订正）

跑一条真实 2 步 SOP（安全工程师 → 小红书运营专家：A 产 token、B 经注入后回显，脚本 `scratchpad/wb-e2e-sop.mjs`）：

- ✅ **门控在真实 dispatch 下成立**：A 的真 worker `running` 期间，B `promote` 被拒、停在 `todo`（S1 在真链路复现）。
- 🔴 **A 的 worker 卡在 `running` 未 complete。** 首次诊断（**事后证实有误，见 §10.4**）：以为是 `engine:codex / model:"default"` 没用成员配置模型导致卡死。
- ⟹ 当时判断：这是 Workboard worker 的执行层问题，影响所有团队执行（现有 Phase 1/2 同样卡），不是 P1 的设计缺陷。P1 控制面（编译→门控→注入→放行）已被原语级 + 真链路门控证实可用。

**结论（首次，见 §10.4 订正）：** P1 设计 **GO**；但「真能跑完一条 SOP」当时判断需先修模型解析。

### 10.3 出路 2：执行层改用 `chat.send`（S4 spike，2026-07-01，✅ 验证可行，纯 controller 侧）

在追查 §10.2 那个"卡死"期间，验证了一条不依赖 `cards.dispatch` 的替代执行路径：controller 直接调用 `chat.send`（就是 `sendToMainSession` 已经在用的那条 RPC，普通专家聊天走的同一条路），target 一个**全新、自己现造**的 subagent lane session key（如 `agent:<memberId>:subagent:<自定义lane>`），而不经过 `cards.dispatch`：

- `chat.send` 是**异步** RPC，立即返回 `{runId, status:"started"}`；真正完成态要轮询 `agents/<memberId>/sessions/sessions.json` 里对应 key 的 `status`（`running`→`done`）。
- 实测：全新 lane key 首次调用，**5s 内 `status:"done"`**，`model:"tabby-fast" / provider:"link"`（成员真实配置的模型），回复内容正确（`SPIKE-S4-OK-77` 精确回显）。
- **不影响成员的 `:main` 会话**（隔离 lane，成员正常聊天不受干扰）。

**这条路径依然有效、依然推荐**——但原因和最初设想的不一样，见 §10.4：它的价值不是"绕开一个卡死的引擎"，而是"完成信号由 controller 自己判定（轮询 session status），不依赖模型自觉调用 workboard 协议工具"——这是比 `cards.dispatch` **更确定性**的完成判定方式。

### 10.4 订正 —— §10.2 的诊断是错的；真根因 + 真修复（2026-07-01）

继续追查 §10.2 的"卡死"时，直接去读**卡片背后的真实 OpenClaw 会话 transcript**（`agents/<id>/sessions/<uuid>.jsonl`，不是卡片的 `metadata`），而不是只看卡片状态，发现：

- **底层 LLM 一轮几秒内就正确跑完**：`model_change` 显示 `provider:"link", modelId:"tabby-fast"`——**就是成员真实配置的模型，根本不是 codex/default**。
- `engine:"codex"` / `model:"default"`（卡片 metadata 里看到的）只是 `buildExecution()` **硬编码的字符串标签 + 未覆写时的哨兵值**，从未真正传给 `subagent.run()`（dispatch RPC 只转发 `boardId`，`options.model` 恒为 undefined），**纯粹是误导性的展示字段，不代表实际执行状态**。
- **真根因：worker-prompt 明确要求"完成后调用 `workboard_complete`"，但模型只是用纯文本正确回答、从未调用该工具——因为这个工具当时压根不在它的可用工具列表里。** 全仓扫描确认：没有任何 agent 有过 `workboard_*` 工具；`openclaw-config-compiler.ts` 的 `SUBAGENT_DELEGATION_TOOLS`（2026-06-30 auto-route 新增）只有 `sessions_spawn/sessions_yield/subagents`，controller 编译器从未授权过 workboard 完成协议需要的工具（不是回归，是从来没配过）。

**修复（已落地）：** `openclaw-config-compiler.ts` 新增 `WORKBOARD_WORKER_TOOLS = ["workboard_heartbeat","workboard_complete","workboard_block"]`（worker-prompt 逐字要求的 3 个），并入所有 agent 的 `tools.alsoAllow`。

**修复后重跑同一 2 步依赖 SOP：**
- Step A（安全工程师/tabby-fast）✅ 完整走完协议（heartbeat + complete），卡正确到 `done`。
- Step B（小红书运营专家/**同样 tabby-fast**）只调了 heartbeat、没调 complete——回复内容完全正确（精确回显了从 A 注入的 token，**证明 §10.1 S2 的变量注入链路在真实 worker 上端到端成立**），但协议合规本身是**概率性**的，同一模型两次表现不同。

**⟹ 最终结论：** 工具授权修复是真实、必要、已验证有效的 bug（对现有 `runTeamTask` Phase 1/2 同样必要，已落地，非新增功能不需要额外决策）。但 `cards.dispatch` 依赖模型自觉调用 `workboard_complete`，天然**不是 100% 确定性**的。**P1 SOP 引擎的完成判定，仍采用 §10.3 的设计**：controller 不依赖 worker 自报完成，而是轮询 session status（`running`→`done`）、自己代 worker 调 `workboard.cards.complete`——完成判定权在 controller 手里，不受模型工具调用合规率影响。两者结合：Workboard 管状态/依赖/崩溃恢复，`chat.send`+controller 轮询管确定性完成。

同样适用于现有 `runTeamTask`（Phase 1/2）——`dispatchSubtasks` 里的 `workboardDispatch` 调用应替换为「读 ready 卡 → `chat.send` 到 `agent:<agentId>:subagent:workboard-<cardId>` → 轮询完成 → `cards.complete`」的 controller 驱动循环。

**已于 2026-07-02 迁移完成。** `dispatchSubtasks`（`team-service.ts`）不再调用 `workboardDispatch`；改为对每张子任务卡直接 `chat.send` 到 `agent:<botId>:subagent:task-<cardId>` 专属 lane，controller 轮询 session status 到 `done` 后自己代调 `cards.comment` + `cards.complete`（失败/超时 → `cards.block`），与 P1 SOP 引擎（`team-workflow-service.ts`）共享同一套确定性完成判定原语。`workboardDispatch` RPC 不再被 team 域调用。真机 `POST /run`、`POST /run-auto` 复测：两张子任务卡稳定到 `done`（此前会概率性卡在 `running`）。迁移中顺带发现并修复一个新引入的 bug：子任务 `title` 一度没有拼进发给 worker 的消息（只传了可选的 `notes`），导致模型反问"请提供具体任务"——已修复并补测试断言防回归。

---

## 11. 开放问题

1. **SOP 与对话的关系：** SOP 跑在团队的 Workboard board 上，结果如何回流到对话流（A2UI 运行卡 vs 独立看板页）？倾向：对话内发一张「运行中」A2UI 卡（步骤点亮），详情进看板。
2. **变量产出的"干净度"：** worker 卡产出常含协议噪声（claim/heartbeat）。注入下游前需取「最终产出段」（`proof`/`artifact`），可能需在 worker 卡 task 末尾要求"只输出成品"（对标 AO meta-prompt 的"干净最终产出"约束）。
3. **compose 修复层的移植成本：** AO 修复层是纯 TS 工具（Levenshtein + DAG 闭包），可较直接移植到 controller；需确认许可（Apache-2.0，可借鉴）。
4. **与 auto-route 的衔接：** 对话内 auto-route 选**单专家**；P2 compose 出**整队**。两者入口如何统一（同一个 find_expert 召回 → 单专家 or 组队的分支）？

---

## 12. 一页速览

- **借什么：** AO 的①声明式可复用计划（SOP）②一句话自动组队（compose + 修复层）③结构化运行视图 + 控制流（loop/approval）④模板库。
- **怎么借：** 全部**编译成现有 `workboard.cards.decompose`**，骑 Workboard 引擎；不引新引擎、不替换 agentic、不耦合系统。
- **先验证：** S1 sibling 依赖 + S2 完成→注入（P1 命门）。
- **先落地：** P1（SOP 编译器 + 依赖 + 传值）+ P4（搬模板），最大化复用刚建好的 teams/Workboard/A2UI。
