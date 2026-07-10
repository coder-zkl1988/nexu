# 对话优先的团队协作：入口进对话、状态进侧边栏、管理留页面

> 创建：2026-07-02
> 关联：[2026-07-01-team-workflow-sop-and-autocompose.md](./2026-07-01-team-workflow-sop-and-autocompose.md)（SOP 引擎）、[2026-06-30-in-chat-expert-auto-route.md](./2026-06-30-in-chat-expert-auto-route.md)（对话内路由 + A2UI 卡先例）

## 0. 问题与结论

产品以对话页为核心，但团队能力（自动分配 / SOP 运行 / 审批 / 进度）目前只活在团队详情页里，造成两个实际问题：

1. **执行路径割裂。** 对话里的队长只会 `sessions_spawn` 自由委派（无看板、无门控、不可观测）；团队页表单走 controller 结构化引擎（落看板、依赖门控、确定性完成判定）。同一个任务两条路，行为不一致。
2. **运行状态活在会被卸载的页面里。** `WorkflowRunView` 内嵌在团队详情页，切走即丢（已用 localStorage 临时止血，本文给根治方案）。

**结论：对话放事件，侧边栏放持续状态，页面放资产管理。**

- 对话流 = 发起（队长调工具走结构化引擎）+ 运行快照卡（含审批按钮）
- 右侧边栏 = 运行详情面板（DAG 点亮 + 步骤产出 + 导出），挂工作区布局层，不随路由卸载
- 团队详情页 = 管理后台（工作流 CRUD / 模板 / compose / 成员管理 / 完整看板），保留

## 1. 架构不变量（设计的三个硬约束）

1. **模型只负责发起，不负责跟踪。** 发起后的进度、审批、导出全部是前端 ↔ controller REST 直连，不再绕模型——§10.4 已证明模型工具调用合规是概率性的，凡是可以不依赖模型的环节都不依赖。
2. **不引第二套执行路径。** 队长工具直接调用现有 `/api/v1/teams/{id}/run-auto`、`/workflows/{id}/run` 端点，复用 controller 驱动执行（chat.send lane + 轮询 + 代调 complete）。**零新增 REST 端点，零 generate-types。**
3. **复用 A2UI 三方协议，不发明新通道。** 快照卡 = A2UI custom component（`propose_expert_install` → `ExpertInstallCard` 同款链路）；详情面板 = `sidebar:` 前缀 surface（既有约定，`A2UISidebarProvider` 挂在 workspace-layout，天然跨路由存活）。

## 2. 组件与数据流

```
用户对话输入（队长会话）
  └─ chat-service 注入 [路由提示：…]（队长版 TEAM_LEAD_HINT）
       └─ 队长模型判断：闲聊→直接答；协作任务→调工具
            └─ nexu-team 插件工具（runtime plugin，ctx.agentId 即队长 botId）
                 ├─ team_run_auto({task})        → 反查团队 → POST /teams/{id}/run-auto
                 ├─ team_list_workflows()        → GET /teams/{id}/workflows
                 └─ team_run_workflow({id,inputs}) → POST /teams/{id}/workflows/{id}/run
                      └─ 工具结果 = ```a2ui 块（TeamRunCard）+ 给模型的一句话指示
                           └─ 前端 sessions.tsx 把 a2ui 注入队长消息 → 渲染 TeamRunCard
TeamRunCard（对话内快照卡，custom component）
  ├─ React Query 轮询 GET /teams/{id}/board（3s，运行中才轮）
  ├─ 步骤点亮列表 + 状态徽章；审批出现 → 卡内【批准】按钮（REST approve，不绕模型）
  ├─ 全部 done → 最终产出预览 + 导出 Markdown
  └─ 「查看详情」→ useA2UISidebar().openWith("sidebar:team-run-<runId>", TeamRunPanel surface)
TeamRunPanel（侧边栏详情面板，custom component，同一数据源）
  └─ WorkflowDagCanvas 点亮 + 选中步骤产出 + 审批横幅 + 导出
```

### 2.1 nexu-team runtime plugin（新增 `static/runtime-plugins/nexu-team/`）

- 模式照抄 find-expert：loopback 调 controller、30s 团队缓存、工具结果内嵌 ```a2ui JSONL。
- **队长鉴权**：工具对全部 agent 注册（factory 拿不到异步查询），`execute` 时以 `ctx.agentId` 匹配 `GET /api/v1/teams` 里的 `leadBotId`；非队长返回明确错误 JSON（工具描述也写明 team-lead only），模型即不再使用。
- 工具结果同时带 `instruction` 字段告诉模型：“运行卡已展示给用户，回复一句确认即可，不要复述计划/步骤”。
- `team_run_auto` 返回的卡片 steps 由 plan 生成（无依赖 → DAG 退化为单 wave 并行）；`team_run_workflow` 返回真实 DAG steps。

### 2.2 chat-service 队长提示

- 新增依赖 `resolveTeamForLead(botId) → {teamId,name} | null`（container 里查 teamLedgerStore）。
- 是队长 → 注入 `TEAM_LEAD_HINT`（引导优先 `team_run_auto` / `team_run_workflow`，闲聊直接答，此时不注入专家路由提示——队长不该被 nudge 去装专家）；非队长维持 `EXPERT_ROUTING_HINT`。
- 前端剥离 pattern 从“全文精确匹配”放宽为通用 `^\[路由提示：[^\]]+\]`，两端文案从此解耦。

### 2.3 前端

- `TeamRunCard.tsx` / `TeamRunPanel.tsx` 注册进 Nexu custom catalog；`sessions.tsx` 的 `A2UI_TOOL_NAMES` += `team_run_auto` / `team_run_workflow`。
- `TeamRunPanel` 是 `WorkflowRunView` 的移植：同样吃 `useTeamBoard` + `useWorkflowApprovals`，渲染 `WorkflowDagCanvas`。
- 团队详情页（S1）：运行工作流后不再内嵌 run view，改为 `openWith` 打开侧边栏同一面板；工作流区块提供「最近运行」按钮（localStorage 记 run 元数据）供关闭后重开。对话里的卡片则永远在消息历史里，点开即恢复。

## 3. 交付边界（v1 明确不做）

- **完成后的“队长转述交付”**：需要 controller 在 run 完成时向发起会话注入一条被显示层剥离的通报消息、触发一轮 agent turn。有先例（技能指令/路由提示剥离）但多一跳模型依赖，v1 用“卡片内完成态 + 产出预览 + 导出”承载交付回流，通报列为后续增强。
- 模板实例化 / compose 进对话：留在团队页。
- 手动逐条指派进对话：不做（页面表单是它的正确归宿）。

## 4. 验收标准

- **S1**：团队页运行工作流 → 右侧边栏自动展开 DAG 面板；切到其他页面再回来（甚至切到聊天页），面板仍在且状态持续点亮。
- **S2**：在与队长的对话里直接说一个协作任务 → 队长调用 `team_run_auto`（不再 sessions_spawn）→ 对话中出现运行卡 → 卡上步骤逐个点亮 → 全部完成后卡上可读产出、可导出；含 approval 步骤的 workflow 由 `team_run_workflow` 发起后，审批按钮出现在卡内，点击后运行继续。
- **S3**：对话里问“有哪些工作流/跑一下 XX 工作流” → 队长 `team_list_workflows` / `team_run_workflow` 正确接卡。
- 非队长 bot 调用团队工具 → 得到明确错误且不再重试；普通聊天不受影响（专家路由 hint 原样）。

## 5. 落地记录（2026-07-02，S1+S2+S3 全部落地并真机 E2E）

**代码：**
- 插件：`apps/controller/static/runtime-plugins/nexu-team/{index.js,openclaw.plugin.json}` —— 三个工具 + `buildTeamRunCard`。⚠️ 踩坑：factory 形式 `registerTool((ctx)=>[…])` **必须**传 `opts.names`（且与 manifest `contracts.tools` 一致），否则注册表记录零工具名、任何 agent 都拿不到工具（首轮 E2E 队长退回 sessions_spawn 就是这个原因）。
- 编译器：`platformPluginIds` += `nexu-team`，entries 注入 `controllerUrl`（同 find-expert 回环模式）。
- chat-service：`TEAM_LEAD_HINT`（队长替换专家路由提示）+ `isTeamLead` 依赖（chat-routes 里查 `teamService.listTeams()`）。前端剥离 pattern 放宽为通用 `^\[路由提示：[^\]]+\]`，两端文案解耦。
- 前端：`TeamRunCard`（对话内快照卡：步骤点亮/审批按钮/完成态产出+导出/查看详情）+ `TeamRunPanel`（侧边栏 DAG 详情，经 `sidebar:` surface 走既有 A2UI 侧边栏通道，挂 workspace-layout 层跨路由存活）。`sessions.tsx` 的 `A2UI_TOOL_NAMES` += `team_run_auto`/`team_run_workflow`。`useTeamBoard` 增加 `{live}` 停轮参数（完成的卡不再永久轮询）。
- S1：`team-workflows.tsx` 移除内嵌 `WorkflowRunView`（由 TeamRunPanel 接替），运行后自动开侧边栏面板；localStorage 只记「最近运行」供重开。

**E2E 中抓到并当场修复的两个真实缺陷（都在既有执行引擎，双引擎同步修）：**
1. **done-无文本导致误 block**：worker 把整个交付灌进 `render_a2ui` 工具调用、turn 以零文本结束；且 OpenClaw 会把排队消息**重放为第二轮 turn**（同一条 user 消息 5s 后再次投递，第二轮才产出文本）。修复：`awaitLaneReply` 把「done 且无文本」从立即失败改为宽限窗口（`emptyDoneTimeoutMs`，默认 60s）内继续轮询、状态翻回 running 时重置；任务消息追加 "as plain text… do NOT render UI (no render_a2ui)"。
2. **comment 超长被拒**：workboard `cards.comment` 上限 **2000 字符**（"comment body must be 2000 characters or fewer"，实测），此前 slice 3800/4000 超限导致长交付无法记录、卡片 blocked。两处 cap 改为 2000。

**真机 E2E（对话驱动全链路）：**
- `team_run_auto`：对话发协作任务 → 队长调工具（不再 sessions_spawn）→ 工具结果含 TeamRunCard A2UI（3 步、分派正确）→ 队长一句话确认（"已经安排下去了"，未复述计划）→ 看板 3 卡全部 `done`（2000ch 截断生效、宽限窗口扛过零文本首轮）。
- `team_list_workflows`：空列表如实回答；建 workflow 后重查正常。
- `team_run_workflow`：自然语言点名工作流 → 运行卡带真实 DAG（2 步含依赖）→ 下游正确引用上游产出（`{{titles}}` 注入并被选用）→ 全部 `done`。注意：队长会**凭上一轮 list 的记忆**answered "没有该工作流"而不重查——用户提示后恢复；属会话记忆行为，非链路缺陷。

**E2E 排查中发现的两个既有问题（已建后台任务，非本次引入）：**
- `GET /teams/{id}/board` 会串出其他 board（含已删团队）的卡片——workboard cards.list 的 board 过滤疑似未生效；团队删除也不清卡。
- tools/dev 多次 `restart` 泄漏旧 controller supervisor（实测同时存活 9 组、最早 6/30），旧 worker 整文件写回 config.json/team-ledger.json，覆盖新建的 bot/团队（两个新建 lead bot 因此凭空消失）。

**遗留（按设计边界）：** run 完成后的「队长转述交付」通报、模板/compose 进对话，均未做（v1 以卡片完成态承载交付回流）。

## 6. S4 —— 免建团队：默认机器人自动拉专家（2026-07-03 落地并真机 E2E）

用户不建团队，任意普通 bot 在对话里即可把任务派发给"按需自动拉取的专家"：

- **端点**：`POST /api/v1/teams/default/run-auto`（静态段注册在 `/{id}` 之前）。响应 `runDefaultTeamTaskResponseSchema = autoRun + teamId`。
- **默认团队**：`TeamService.ensureDefaultTeam()` 惰性创建「默认专家团」（`isDefault: true`，schema 新增可选字段），一装一个、幂等复用；成员集随规划自动增长。
- **全目录召回**：`expert-recall.ts` 把 find-expert 插件的词法打分（拉丁词 + CJK bigram，name×5/tags×3/category×2/description×1）搬进 controller，`recallExperts(catalog, task, 12)` 产出规划器 roster —— `planSubtasks` 的 members 参数形状本就是 `{slug,name,description}`，零改动复用。
- **自动入队**：plan 指派的非成员专家经 `updateTeam`（resolveMembers 自动安装）入队后再 dispatch。
- **插件**：nexu-team 第 4 个工具 `expert_run_auto`（非队长用；队长调用会被引导回 team_run_auto）。工具与 find_expert 的分工写进 description：快问快答走 find_expert+spawn，需要交付物/多专家才派发。
- **提示词**：`EXPERT_ROUTING_HINT` 增补 expert_run_auto 分支；前端 `A2UI_TOOL_NAMES` 收录之（TeamRunCard 通吃，前端零新组件）。

**真机 E2E**：普通 custom bot 对话发"组织专家做便携咖啡机推广方案" → `expert_run_auto` → 「默认专家团」自动创建 + 2 位专家自动入队 → 3 步计划运行卡 → 3 卡全部 `done`（2000ch 截断生效）。第二个任务（保温杯竞品分析）→ **同一** teamId 复用 ✓，且按任务语义自动拉入 3 位不同领域专家（product-feedback-synthesizer / sales-pipeline-analyst / design-ux-researcher）——目录召回与成员自动增长实证。测试团队已清理（真实用户首次使用会自然重建）。
