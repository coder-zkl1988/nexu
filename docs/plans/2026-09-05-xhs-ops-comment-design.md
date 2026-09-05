# 小红书养号 · 评论功能设计稿（P3-1，D0）

> 状态：**已评审通过（2026-09-06），决策见文末 §11**，进入 D1 排期（排在三个真机小修之后）。拍板记录（2026-09-04）：评论**现在立项**，排 P3 首位，**先设计后实现**；运营文档原话「评论需先设计内容审核与风控」。脑图给评论的权重是 3%，即它是浏览之外的点缀，不是主线。

## 1. 目标与非目标

**目标**
- 让养号账号在浏览之余发出**少量、正向、与帖子相关**的评论，提升账号"真人感"，不触发风控。
- 每一条发出的评论都经过**人工审核**；机械上保证**未审核的文字不可能被手机发出**。
- 评论数据进入现有账本（run.summary / 看板），可复盘。

**非目标（一期不做）**
- 不做"自动评论"（无人审核直接发）。
- 不做回复他人评论、不做私信、不做@。
- 不做评论效果追踪（被赞/被回复/被删）——二期可选。

## 2. 风控规则（写进生成提示词 + 审核界面 + 手机策略三处）

| 维度 | 规则 | 落在哪 |
|---|---|---|
| 内容 | 正向认同、针对帖子内容、≤10 字、无营销/链接/联系方式/品牌名/价格、不带表情堆叠 | 生成提示词 + 审核界面校验（长度/关键词黑名单） |
| 对象 | 只评**本账号当天已完整浏览且已看 ≥3 条评论**的图文帖；广告/带货/直播/用户主页不评 | 候选只来自 RECORD_JSON.posts（手机标注） |
| 频次 | 每账号每日上限默认 2、硬上限 5；每 ≥8 篇浏览最多 1 条；两条评论之间 ≥2 篇纯浏览；同一作者一天最多 1 条 | 桌面配额计算（见 §5） |
| 时机 | 评论任务在浏览 run 之后、同一天内、与浏览间隔 ≥10 分钟；不在 23:00–08:00 | 调度器 / RunPlanner |
| 熔断 | 出现 `rate_limited` / `account_restricted` / `login_required` → 当日停评并在看板标红；连续 2 天熔断 → 自动关闭该账号评论开关 | 手机异常回填 → 桌面状态机 |
| 文字白名单 | 手机端 TYPE 的文本必须**与任务文本中给出的审核文案逐字相同**，否则策略引擎拒绝执行 | TabbyApp `ActionPolicyEngine`（§6） |

## 3. 数据模型（packages/shared/src/schemas/xhs-ops.ts）

```ts
// 账号侧：comment 从 literal false 变为可配置，UI 一期默认关
interaction.comment: { enabled: boolean=false, dailyCap: int 0..5 = 2 }

// 评论草稿（新集合 comments，随 xhs-ops.json 落盘）
xhsOpsCommentDraftSchema = {
  id, projectId, accountId, deviceId,
  sourceRunId: string,            // 候选来自哪次浏览 run
  post: { title ≤40, author ≤30, summary ≤120 },   // 手机回传的帖子摘要
  candidates: string[] (1..3, 每条 ≤10 字),         // 桌面生成
  text: string | null,            // 审核后最终文案（可改写），≤10 字
  status: "pending" | "approved" | "rejected" | "sent" | "failed" | "expired",
  reviewedAt, reviewNote,
  sentRunId, sentAt, sendResult,  // 执行回填
  createdAt, updatedAt,
}

// 评论执行 run：复用 xhsOpsRunSchema，plan 增 mode 区分
run.plan.kind: "browse" (默认) | "comment"
run.plan.comments: [{ draftId, postTitle, postAuthor, text }]   // kind=comment 时
chunk.mode 增 "comment"（每条评论一个 chunk）
summary.interactions 增 comment: count
```

审核状态机：`pending → approved | rejected`；`approved → sent | failed`；当天未执行的 `approved` 次日 `expired`（帖子时效性）。

## 4. 端到端流程

```
浏览 run（现有）           桌面生成            人工审核              评论 run              回填/看板
──────────────            ──────────         ──────────           ──────────           ──────────
手机 RECORD_JSON.posts    对 commentWorthy   XhsOpsCommentReview  独立任务文本          RECORD_JSON.comments
增 commentWorthy +        帖子生成 1–3 条    批准/改写/拒绝        「小红书评论任务」    → draft.status
summary（只标注，不写）    候选 → pending     每账号今日配额提示    每条一个 chunk        → run.summary
```

1. **候选采集（手机，改动最小）**：research.md 的 RECORD_JSON `posts[]` 增两个可选字段：`commentWorthy: true|false`（判断标准：图文、与账号定位强相关、评论区氛围正向、无争议）、`summary`（正文一句话 ≤60 字）。手机**不写评论、不进评论框**。
2. **桌面生成**：`XhsOpsCommentService.generateCandidates(runId)`：对 `commentWorthy` 的帖子，用 `MediaGenerationService.generateText`（复用资料生成的 JSON-only 提示词模式）生成 1–3 条候选：输入 = 账号人设 + 帖子标题/摘要 + §2 内容规则 + 项目禁忌词；输出 JSON `{"candidates":["…","…"]}`；桌面再做硬校验（长度 ≤10、黑名单、去重、与最近 30 天已发评论文本去重）。落 `pending`。
3. **人工审核（组件 `XhsOpsCommentReview`）**：按账号分组列出 pending：帖子标题/作者/摘要、候选 chips（点选即填入文案框，可改写）、批准 / 拒绝 / 全部拒绝；顶部显示"今日配额 已批准 x / 上限 y（按浏览量最多 z）"，超配额时批准按钮禁用；上报 `xhs_ops_comments_reviewed {approved, rejected}`。**没有"自动批准"选项。**
4. **执行（评论 run）**：RunPlanner/调度器在浏览 run 完成 ≥10 分钟后创建 `kind=comment` 的 run，`taskPolicy` 带 `confirmationPolicy.comment: "allowed"` 与 `commentAllowlist: [text…]`（见 §6）。任务文本模板（新子技能 `comment.md`）：
   - 头：`【小红书评论任务｜账号定位：X｜审核批次：<draftIds>】`
   - 每条：搜索帖子标题 → 进入 → **核对作者名与任务一致**，不一致跳过并记 `post_not_found` → 慢滑看正文 5–10 秒 → 点评论框 → `TYPE` **任务给出的原文**（单次）→ 发送 → 确认评论出现在评论区（自己昵称 + 原文）→ `BACK` 回列表
   - 两条之间至少浏览 1 篇不评论的帖子
   - 禁止：改写文案、评论任务外的帖子、回复他人、连发
   - 结束 RECORD_JSON：`{"v":1,"mode":"comment","comments":[{"draftId","status":"sent|failed|skipped","detail"}],"anomalies":[…]}`
5. **回填**：`interpretTaskResult` 解析 `comments[]` → draft.status；run.summary.interactions.comment；`ReportAuditor` 校验 sent 数 ≤ 回执里的有效点击数（现有 `[回执]` 机制）。看板关键词表/账号 × 日期矩阵增"评"计数；异常汇总多 `post_not_found`、`comment_blocked`（策略拒绝）两类。

## 5. 配额与稀疏（桌面计算，手机不用数）

```
todayBrowsed   = Σ 今日该账号 completed 浏览 run 的 summary.browsedTotal
byBrowse       = floor(todayBrowsed / 8)
cap            = min(interaction.comment.dailyCap, 5, byBrowse)
remaining      = cap − 今日已 sent − 今日已 approved 未执行
```
审核界面只允许批准到 `remaining`；评论 run 一次最多带 `remaining` 条；同一手机多账号的评论 run 走现有设备队列串行；同一账号两次评论 run 间隔 ≥60 分钟。

## 6. 机械阻断：TaskPolicy `comment` 标签 + 文本白名单（TabbyApp）

现状：`XHS_TASK_POLICY.confirmationPolicy = { publish: forbidden, payment: forbidden }`，评论没有标签，靠技能文本"永远禁止评论"。这不够——**未审核内容不能被发出**必须是机械保证。

- `DeviceTaskPolicy.confirmationPolicy` 增 `comment: "forbidden" | "allowed"`，默认 `forbidden`。所有浏览/研究/资料/发布任务保持 forbidden；只有 `kind=comment` 的 run 带 `allowed`。
- 增 `commentAllowlist?: string[]`：`allowed` 时必填，最多 5 条，每条 ≤10 字。
- TabbyApp `ActionPolicyEngine.evaluateDeviceAction`：
  - 识别"评论编辑态"：当前焦点/目标控件的 a11y 提示含「说点什么」「写评论」「评论」且为可编辑，或 TYPE 的目标点落在评论输入框节点内（a11y 树已注入，v5.16 可拿到节点 bounds）。
  - `forbidden` 时：评论编辑态下的 `TYPE`、以及命中「发送/发布」按钮的 `CLICK` → 拒绝，执行结果写 `POLICY_COMMENT_FORBIDDEN`，模型必须 `BACK`。
  - `allowed` 时：`TYPE` 文本必须 **逐字等于** allowlist 中某一条（去首尾空白），否则拒绝并写 `POLICY_COMMENT_TEXT_NOT_ALLOWLISTED`；每条 allowlist 文本只允许成功 TYPE 一次（防重复发）。
- `GelabPromptBuilder` 在 forbidden 策略下追加一句「本任务禁止评论：不进入评论输入框，不点发送」；allowed 时列出允许文案，说明"只能原文粘贴"。
- 单测：TaskPolicyTest（forbidden 拒 TYPE/发送；allowed 放行原文、拒改写、拒二次）；GelabActionParser 不变。
- 技能：`interact.md` 的「评论永远禁止」改为「除【小红书评论任务】外禁止评论」；新增 `comment.md`（§4 步骤 4），关键词「评论任务」，优先级与 research 同级。

## 7. 观测与复盘

- 看板：账号 × 日期格子增 `评 n`；关键词表增"评论"列；异常汇总新增两类；观察时间线收评论 run 的 observation。
- 审核队列统计：pending / 今日批准 / 今日 sent / 拒绝率；拒绝率 >70% 说明生成提示词要改。
- 日志：controller `xhs-ops: comment …` 系列；手机 logcat 里 `POLICY_COMMENT_*` 必须为 0（有就是任务文本或模型越界，要查）。

## 8. 分期与工作量

| 阶段 | 内容 | 依赖 | 估算 |
|---|---|---|---|
| D0 | 本设计稿评审 | — | 0.5d |
| D1 桌面基建 | schema（comments 集合 / interaction.comment / plan.kind）、`XhsOpsCommentService`（候选生成 + 配额）、REST、`XhsOpsCommentReview` 组件、看板列 | 可与 P2 并行，无手机改动 | 2d |
| D2 手机阻断 | TabbyApp TaskPolicy `comment` 标签 + allowlist + 评论编辑态识别 + 单测；tabby-control 透传策略 | D1 schema | 1.5d |
| D3 手机技能 | research.md `commentWorthy/summary` 标注；新 `comment.md`；interact.md 改口 | D2 | 1d |
| D4 灰度 | 1 个账号、每天 1 条、人工全审，跑 5 天看是否有风控信号 | D1–D3 | 5d 观察 |
| D5 放量 | 每账号 2 条、多账号 | D4 通过 | — |

## 9. 验收标准

1. 任何一条被发出的评论，在 `comments` 集合里都有 `approved` 记录，且 `text` 与手机 TYPE 的文本逐字相同（logcat 可查）。
2. 在 forbidden 策略下人为构造"让模型去评论"的任务，手机端 `POLICY_COMMENT_FORBIDDEN` 拒绝且任务不会发出任何评论。
3. 5 天灰度内：0 次 `rate_limited/account_restricted`；评论被删除数 ≤1；审核拒绝率 <50%。
4. 看板能回答"这个账号本周评了几条、评在哪些帖子、有没有异常"。

## 10. 开放问题（评审时已全部拍板，见 §11）

- 帖子摘要来源 → a11y 页面文本（标题 + 正文首屏），视频帖无正文则不评。
- 候选生成模型 → 复用资料生成的 `generateText` 通道；拒绝率 >50% 再换。
- 帖子搜不到 → 跳过并标 `post_not_found`，不补发；灰度期统计比例，高了再考虑让手机回传链接。
- 限流后恢复 → 当日停评，连续 2 天则自动关闭该账号评论开关，人工重开；待审评论保留，当天未发的次日过期。

## 11. 评审决策记录（2026-09-06）

| 决策项 | 结论 |
|---|---|
| 每日频次 | 每账号默认 2 条，硬上限 5；每浏览 ≥8 篇最多 1 条；两条之间 ≥2 篇纯浏览；同一作者一天 1 条 |
| 文案规则 | ≤10 字，正向认同，针对帖子内容；无营销/链接/联系方式/品牌/价格；不带表情堆叠 |
| 灰度节奏 | D4：1 个账号 × 每天 1 条 × 5 天，人工全审；通过后放量到默认上限与多账号 |
| 帖子摘要 | a11y 页面文本，手机在 RECORD_JSON.posts 里多回传 `commentWorthy` + ≤60 字 `summary` |
| 候选模型 | 复用 `MediaGenerationService.generateText`（与昵称/简介同通道） |
| 搜不到原帖 | 跳过 + `post_not_found`，不补发 |
| 限流恢复 | 当日停评；连续 2 天自动关开关；人工重开 |
| 开工顺序 | 先推送三仓 → 三个真机小修（SCROLL 抖动 / 首页块步数预算 / 荣耀提示自动点掉）→ D1 桌面基建 |
