# KOC 小红书养号模块 · 路线图（含脑图项）

> 需求来源：运营《KOC账号养号模块｜运营流程需求 V0.1》+ 原始脑图。
> 冲突规则：**文档为准**，脑图特有项纳入 P2/P3；脑图与文档相抵的（评论 3%）按文档一期不做、后置为单独设计。
> 状态基线（2026-09-04）：xhs-ops 三件套已接线（controller 路由/执行器/LowDB store、web 4 组件、nexu-a2ui 插件 4 组件类型 + 四阶段路由、TOOLS.md）；手机端 xhs 技能 v31（research/nurture/profile 子技能齐备）；REST 冒烟与渲染/路由测试通过；**端到端已无头走通一次**（2026-09-04 晚，聊天 API 回放六阶段：ProjectForm → ProfileCard 确认 → AccountPlanner → RunPlanner → 真机执行 run 5e513285（3/3 篇、0 异常）→ `xhs_ops_run_finished` 复盘，agent 未重复派发并按指令询问记录观察/每日自动）。首跑暴露并修复两处链路缺陷：① 手机端把汇报换行写成字面 `\n` 导致 RECORD_JSON 解析失败（TabbyApp 解析器反转义 + controller `parseRecordJson` 容错）；② `TaskPolicy` 用原始应用名判角色把 AWAKE 小红书拦成 `role=other`（别名表映射 + 运行器预解析）。首跑观察：agent 默认给 4 个人设而非文档最小闭环的 10 个（P1-2 顺带在插件描述里写明默认 10）；人口学信息全在 positioning 一句话里（印证 P1-2）。测试项目「新氧青春·亲子度假」（2 账号、2 run）保留在 xhs-ops.json 作为首个真实项目。

## 0. 需求 → 现状对照

| 文档流程 | 状态 | 缺口 |
|---|---|---|
| 客户信息输入 | ✅ | — |
| 画像生成 + 人工确认 | 🟡 | 生成靠 agent 提示词，未端到端验证 |
| 批量差异化人设 | 🟡 | account 无年龄/性别/地区/职业/生活状态字段；无差异检查 |
| 账号基础资料（昵称/简介/头像/背景） | ❌ | 无字段、无生成、无落库、无应用 |
| 兴趣池三层 | ✅ | 无轮次历史（一期可接受） |
| 当日任务生成 | 🟡 | 未按兴趣池自动生成；`searchRatioPercent`/`ratioPercent` 存了未消费 |
| 搜索/首页浏览执行 | ✅ | 脑图"点首页刷新换内容/不每篇都点进"未建模 |
| 互动可配置 | 🟡 | 开关+日上限生效，触发比例不生效；评论恒禁 |
| 执行结果记录 | ✅ | — |
| 记录→下一轮 | 🟡 | 缺跨账号/跨天复盘看板 |

脑图特有项：账号创建流程（改名/性别/年龄/头像/背景/简介/兴趣标签）❌｜素材生成（半身照头像、风景背景图、星座+MBTI 简介）❌｜80-100 篇/天（单 run 上限 8 词×8 篇+12 首页=76 篇≈100 分钟）容量缺口｜评论 3%（与文档冲突，后置）。

## P1 · 最小闭环（对齐文档 §五）—— ✅ 四项全部完成（2026-09-04）

### 1.1 端到端走通聊天流
- 目标：桌面聊天「创建小红书养号项目」→ ProjectForm → 画像 ProfileCard 确认 → AccountPlanner 生成 10 人设并绑 2-3 台手机 → RunPlanner 生成当日计划 → 执行 → RECORD_JSON 回填 → notes 复盘。
- 改动：只修坑，不加功能。重点观察 agent 是否按 TOOLS.md 四阶段顺序渲染、`xhs_ops_*` 动作是否正确回流、手机是否返回 RECORD_JSON。
- 验收：一个真实项目从头到尾在聊天里完成，LowDB `xhs-ops.json` 里 project/accounts/runs 齐全。

### 1.2 人设结构化字段 —— ✅ 已完成（2026-09-04）
> shared `xhsOpsPersonaSchema`（age/gender/region/occupation/lifeStatus，可空兼容旧数据）；AccountPlanner 行内五项编辑 + 建议卡摘要；任务头 `人设：32岁·女·…`；插件 suggestions 要求 persona 且默认 10 个；实测 agent 产出 10 人设全带结构字段、分布贴合画像。
- 改动：`packages/shared/src/schemas/xhs-ops.ts` account 增 `persona{age, gender, region, occupation, lifeStatus}`（可选，兼容旧数据）；AccountPlanner 行内展示/编辑；插件 `XhsOpsAccountPlanner.suggestions` schema 增同名字段并要求 agent 填写；任务文本 header 把 persona 一句话化并入「账号定位」。
- 验收：10 人设每个都有五项人口学字段；文档"整体分布贴合目标消费者"可肉眼核对。

### 1.3 人设差异检查 —— ✅ 已完成（2026-09-04）
> `findPersonaOverlaps` 四规则（定位名重复 / 地区+职业相同 / 年龄+性别+生活状态相同 / 核心兴趣 Jaccard≥60%），行内琥珀告警不阻断；`xhs_ops_accounts_saved` 携带 `overlapWarnings` + agentInstruction；实测 agent 指出相似对并给出四条拉开差异方向、询问后再改。
- 改动：AccountPlanner 纯前端规则——label 重复、`region+occupation` 组合重复、兴趣池 core 集合 Jaccard ≥ 0.6 任一命中 → 行内黄色告警（不阻断保存）；agent 收到 `xhs_ops_accounts_saved` 时附带告警列表以便重生成。
- 验收：故意造两个相似人设能被标出。

### 1.4 当日计划确定性生成 + 比例字段生效 —— ✅ 已完成（2026-09-04）
> `xhs-ops-plan-suggest.ts`：核心词按轮次轮换取 3、与上轮集合相同则前移、扩展/泛各 1、首页篇数由 searchRatioPercent 反推；`GET /projects/{id}/plan-suggest` 只含已绑设备账号并附生成依据；`computeChunkQuota` 按 ratioPercent 封顶（0 = 不互动）；RunPlanner 无 plans 自动拉建议并展示依据；插件 plans 改可选。真实项目验证：豆豆妈第 3 轮轮换正确、首页 6 篇；新会话 agent 只传 projectId。
- 改动：controller 增 `POST /api/v1/xhs-ops/projects/{id}/plan-suggest`（或 service 函数）——按每账号兴趣池生成：core 轮换 2-3 词、extended 1 词、general 1 词，避开该账号昨日 run 的关键词集合；`homeFeedCount` 由 `searchRatioPercent` 反推（总篇数 × (1-ratio)）；`ratioPercent` 进 `computeChunkQuota`：chunk 配额 = min(日上限分摊, ceil(planned × ratio%))。RunPlanner 首屏直接拉建议计划，agent 不再手拼 plans（保留可传）。
- 验收：连续两天的计划关键词不完全相同；把点赞比例调 0 后 chunk 配额为 0；把搜索占比调 100 后无 home chunk。

## P2 · 运营化（脑图项主要落在这里）

### 2.1 账号基础资料与素材生成（脑图「素材生成」+「账号创建」）—— ✅ 已完成（2026-09-05）
- 数据：account 增 `profileDraft{nickname, bio, avatarPath, coverPath, appliedAt}`。bio 按脑图结构生成：星座+MBTI / 自我介绍 / 兴趣介绍，与 persona、兴趣池一致，避免营销感。
- 生成：昵称/简介由 agent 生成（与 1.2 同一轮）；头像「人物半身照+自然环境背景」、背景图「知名地区风景+人物背身」走现有 `image_generate`，**每槽位直接生成 3 张备选**落 media 目录，运营在组件里点选（已拍板：直接 AI 生成备选；人工上传仅作兜底）。
- 应用到手机（脑图「按流程创建账号」）：新任务模板「资料维护」——先 `pushMedia` 推头像/背景到相册，再按 xhs `profile` 子技能改名/性别/生日/地区/职业/头像/背景/简介/兴趣标签；结果回填 `appliedAt`。执行器复用 `XhsOpsRunService` 的 waitForIdle/executeTask，taskPolicy 仍禁 publish/payment。
- 组件：`XhsOpsProfileMaterial`（预览昵称/简介/头像/背景，可改、可重生成、可「应用到手机」）。
- 验收：2-3 个账号资料在真机上被改成生成值；档案库（account 列表）可查每个账号的资料与应用时间。
> 落地：`account.profileDraft{nickname,bio,avatarCandidates[3],coverCandidates[3],avatarPath,coverPath,generatedAt,appliedAt,applyStatus,applyResult}`；`XhsOpsProfileService.generate(accountId, parts)` 走 `MediaGenerationService`（文本：JSON-only 提示词，昵称 ≤12 字、简介三段 ≤100 字、带人设/兴趣池/禁忌、禁营销话术；头像 1:1「人像半身+自然环境」、背景 16:9「地区风景+背身」各 3 张落 media 目录）；`apply(accountId)` = 校验图片在 media 根目录内 → `pushMedia` 推入「Tabby」相册（`tabby-avatar-<id8>`/`tabby-cover-<id8>`）→ 下发「资料维护」任务（只改请求的字段、单次 TYPE、隐私规则、末尾 `PROFILE_JSON:{nickname,bio,avatar,cover: done|failed|skipped}` 契约）→ 回读写 `applyStatus/applyResult/appliedAt`；设备忙 409、未绑定/无内容 400。REST：`POST /api/v1/xhs-ops/accounts/{id}/profile-draft/generate|apply`。组件 `XhsOpsProfileMaterial`（按账号：昵称/简介可改 + 生成、头像/背景 3 选 1 缩略图走 `/api/v1/media/state-file`、保存草稿、「应用到手机」二次确认；上报 `xhs_ops_profile_material_saved` / `xhs_ops_profile_applied`）；插件 schema + 四阶段描述加 3b 可选阶段（明确「应用到手机」只由用户触发）；TOOLS.md 同步。测试：profile-service 8、routes +1、web 渲染 +1，controller/web 全绿。
> 实盘（2026-09-05，测试账号「豆豆妈…」）：文本生成 54s 得「豆豆妈周末不折腾 / 处女座ENTJ，计划控。32岁海淀互联网妈妈…」（结构与脑图一致、无营销感）；头像 3 张 69s，每张 ~2.2MB PNG，state-file 端点 200 可显示。**未做**：真机「应用到手机」（会改真实公开资料，留给运营在组件里点）。

### 2.2 复盘看板 `XhsOpsDashboard` —— ✅ 已完成（2026-09-05）
- 纯读组件：项目 × 账号 × 日期矩阵（计划/实际/首页量/互动次数）、异常汇总（按 type）、observation 时间线、notes 编辑。数据全来自 `GET /runs`。
- 验收：运营不看聊天记录也能判断"推荐流是否更接近目标兴趣"并决定改兴趣池。
> 落地：无新增接口，数据来自 `GET /runs?projectId` + 账号列表。纯函数层 `xhs-ops-dashboard-data.ts`（`lastNDates`/`buildRunMatrix`/`summarizeAnomalies`/`collectObservations`/`keywordStats`）+ 组件 `XhsOpsDashboard{projectId, accountId?, days?}`：顶部汇总（运行次数/计划·实际/首页/互动/异常）→「账号 × 日期」矩阵（每格 实际/计划 + 首页/互动/异常，最差状态点；已绑定账号无运行也占行以暴露断档，已删账号沿用 label 快照）→ 点格子展开当日明细（每个 run 的环节表：实际/计划、跳过、赞藏关、状态·异常 chips、手机端观察）+ 运营备注（PATCH notes，上报 `xhs_ops_dashboard_note_saved` 并附 agentInstruction：只给兴趣池建议、不复述）→ 关键词表现表（按搜索词汇总，标注核心池账号；判断规则：出现无结果/内容不匹配 → 建议调整，样本 ≥4 且完成率 <50% → 观察，否则正常；首页推荐流单独一行）→ 异常汇总（按类型计数 + 最近一次位置）→ 观察时间线（手机端观察 + 运营备注，倒序，默认 8 条可展开）。有执行中的 run 时 5s 轮询。7/14/30 天可切。插件 schema + 路由描述（复盘/看板/推荐流有没有变 → 只读看板，禁止凭记忆回答或重派）+ TOOLS.md 第 5 步。测试：数据层 6 条（矩阵/异常/时间线/关键词判定/日期/项目名匹配）+ 渲染 2 条。
> 无头 e2e（2026-09-05）：新会话直接问「帮我复盘一下「新氧青春·亲子度假」最近一周的效果」。**首跑失败两处**：① agent 没走看板，去 `sessions_history`/`memory_search`/`exec` 翻用户目录找运行数据（跑了 5 分钟被我取消）——原因是 bot 工作区 TOOLS.md 还是旧块（模板块靠 `syncAll` 同步，需 `POST /api/internal/desktop/cloud-refresh` 或重启 controller），且 agent 在新会话里根本没有 projectId、也没有列项目的工具；② 同步后 agent 第一步就渲染看板，但 `render_a2ui` 校验报 `type must be equal to constant`——网关加载的是 `state/extensions/nexu-a2ui` 副本，只有 controller 启动时的插件写入器会刷新它，`pnpm dev restart openclaw` 不够（详见记忆 nexu-plugin-and-template-deploy-path）。修复：看板 `projectId` 改为可选，新增 `projectName`，匹配不到就在卡片内让用户点选项目（`pickProjectByName`：精确 > 唯一子串 > 唯一项目）；TOOLS.md/插件描述改成「结果类问题第一步就渲染看板；运行数据只在桌面 xhs-ops 存储，不在会话/记忆/文件里」。**复跑 24s 通过**：agent 第一个工具调用即 `render_a2ui XhsOpsDashboard{projectName}`，渲染成功并只做导读，不复述数据。同类「新会话无 projectId」问题也适用于 ProfileMaterial/RunPlanner——记入 P2 尾项。

### 2.3 每日容量（脑图 80-100 篇/天）—— ✅ 已完成（2026-09-05，可选能力，默认单 run）
- 现实：单 run ≤76 篇、约 100 分钟；风控风险随篇数上升。
- 方案：account 增 `dailyTargetPosts`；调度把日目标拆成 2-3 个 run（上午/下午/晚上）串行执行，run 记 `dailyProgress`；看板显示当日累计。
- **已拍板：80-100 不是硬性要求。** 一期按 30-50 篇/账号/天跑一周观察风控与推荐流变化；`dailyTargetPosts` 与多 run 拆分作为可选能力实现，默认单 run。
> 落地：`browseDefaults` 增 `dailyTargetPosts`（0..150，0=不设）与 `dailySegments`（1..3，默认 1）；run/计划建议增 `segment{index,count}`（单 run 为 null）。`suggestDailyPlans(account, runs, today)`：段数 1 时等价原 `suggestPlan`；>1 时每段视作"下一轮"轮换核心词、避开上一段集合，每段总量 ≈ 日目标 ÷ 段数（按搜索占比切搜索/首页，每词篇数取整并钳 1..8，首页 ≤12，超限在依据里说明）；当天已有的段（非取消）不再建议，下午打开只剩未跑的段；日目标 >0 且单段时也按目标重算篇数。RunPlanner：每段一张卡（标题带「第 k/n 段」），第 k 段锁定到第 k-1 段结束（含页面重载后从当日 run 恢复），顶部「自动接续下一段」开关默认开，解锁瞬间自动派发；`xhs_ops_run_finished` 载荷带 `segment`。AccountPlanner 浏览默认值多两格；看板当日明细显示段徽标。插件描述/TOOLS.md 说明「每段一个 finished，等最后一段再复盘」。测试：plan-suggest +4、routes +1（segment 落库 + 建议跳过已跑段）、web 类型 +3；全绿。**未做**：真机上跑一次 2 段串行（会占用手机约 40 分钟）；建议运营在一个账号上把分段数设 2、日目标 30 试跑一天。

### 2.4 定时触发 + 设备队列
- OpenClaw cron（已启用）→ controller 内 xhs-ops 调度器（cron 只投递 agentTurn 无法带账目，需胶水）→ 对每个启用账号 `plan-suggest` + `createRun` + `startRun`。
- per-device 串行队列：多账号绑同一手机时按设备排队，避免各自 3s 轮询抢 `TASK_ALREADY_RUNNING`；绑定时校验设备在线。
- 验收：早 10 点自动跑起 2-3 个账号，同一手机的两个账号先后执行。

### 2.5 脑图浏览细节进手机技能（research.md）
- 「不要每篇都点进去」：结果页随机跳过 20-40% 卡片（只滑不进）；「时不时点首页刷新切换内容」：首页模式每 3-5 篇回顶/下拉刷新一次；下滑距离随机化（SCROLL distance 在 250-650 间变化）。
- 验收：一次 run 的 logcat 里能看到跳过与刷新动作。

## P3 · 延后 / 单独设计

### 3.1 评论（脑图 3%；文档一期不做）—— **已拍板：现在立项，排在 P3 首位**
- 前提：先设计评论内容审核与风控（文档原话）；立项后先出设计稿再动代码。方案雏形：生成规则「正向认同、≤10 字、不含营销、针对帖子内容」→ 桌面审核队列（人工放行）→ 每日上限与稀疏分布 → 手机 `interact` 子技能执行 → 回填。TaskPolicy 需新增 comment 阻断标签，保证未审核内容不会被发出。
- 不在一期验收里，但设计与审核队列的基建可与 P2 并行推进。

### 3.2 其他
- 新会话无 projectId 的兜底：`XhsOpsProfileMaterial`/`XhsOpsRunPlanner` 也应像看板一样支持省略 `projectId`（按 `projectName` 匹配或卡片内点选），否则 agent 只能在同一会话里从 `xhs_ops_project_saved` 拿到 id。
- 登录保活（`login_required` 会停整轮；需预检或定期 login 任务）。
- 兴趣池轮次快照（复盘"改了什么"）。
- run 归档（LowDB 500 条上限≈10 账号×50 天）。
- 停留时长设备侧度量（RECORD_JSON 加 dwellSec；目前只能信模型自述）。

## 决策记录（2026-09-04 已拍板）
1. 80-100 篇/天**不是硬性要求**——一期 30-50 篇观察，多 run 拆分为可选能力（2.3）。
2. 评论**现在立项**，排 P3 首位，先设计后实现（3.1）。
3. 头像/背景**直接 AI 生成备选**（每槽位 3 张），人工上传仅兜底（2.1）。

## 风险
- 浏览真实性（停留/评论阅读）只有提示词与账本对账约束；复盘闭环是主要纠错机制。
- 规则越加越多会碰上 GLM 执行力衰减，手机技能改动坚持"替换不追加"。
- 车队级：技能同步依赖 tabby-control 在线；内置包已同步 v31 作兜底。
