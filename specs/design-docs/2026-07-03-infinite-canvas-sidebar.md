# 右侧边栏 → 无限画布工作台（Infinite Canvas Workbench）

> 创建：2026-07-03
> 关联：[2026-07-02-chat-first-team-operations.md](./2026-07-02-chat-first-team-operations.md)（侧边栏 = 持续状态的定位）
> 交互参考：github.com/basketikun/infinite-canvas（**AGPL-3.0 完整应用，只借鉴交互范式，不引入任何代码/依赖**；其渲染同为 DOM-based React 组件，验证了我们的零依赖路线）

## 0. 目标与结论

右侧边栏从「单内容预览面板」升级为「**无限画布工作台**」：

1. **多节点并存**——现状一次只能显示一个 A2UI surface（新的顶掉旧的）；画布上每个 surface 是一个可拖动的节点卡片，运行面板、XHS 编辑器、Markdown 文稿可以同时铺开对照。
2. **平移/缩放**——滚轮以指针为中心缩放，拖拽空白处平移，一键适配全部节点。
3. **为影音创作 tab 打基础**——画布容器与"侧边栏"解耦（`lib/canvas/` 独立组件），未来图像/视频生成节点、连线编排直接复用同一容器。
4. **零新依赖**——DOM-based 自研（CSS transform），现有 React 组件（A2UIRenderer/TeamRunPanel/XHSEditor…）**原样**作为节点内容，无需改造。

## 1. 架构

```
lib/canvas/infinite-canvas.tsx     纯展示容器（受控 viewport + 节点渲染）
  - viewport {x, y, scale}，wheel=以指针为中心缩放(0.25–2)，背景拖拽=平移
  - 节点 = 绝对定位 frame（header: 标题+关闭，body: children）
  - header 拖拽移动节点；fit/reset 控件
  - 导出纯函数 zoomAtPoint / fitViewport 供单测

lib/a2ui/a2ui-sidebar-context.tsx  状态升级：单 surface → 节点集合
  - nodes: Array<{surfaceId, title, messages, onAction, position}>
  - openWith(surfaceId, messages, onAction, opts?)  ← 签名向后兼容
      已存在同 surfaceId → 更新内容并置顶；否则新增节点（级联布位）
  - closeNode(surfaceId) / close()（收起画布，节点保留在内存）
  - viewport + 各 surfaceId 位置持久化 localStorage
    （messages/onAction 含闭包，不持久化——刷新后节点内容按入口重开）

layouts/workspace-layout.tsx       右侧栏渲染 InfiniteCanvas
  - 头部「工作台」+ 节点数 + fit + 关闭
  - 显示条件从 rightSidebarOpen && isSessionRoute 放宽为 rightSidebarOpen
    （修复：团队页 openWith 后侧栏不显示的 S1 漏洞）
```

所有既有入口（sessions 自动打开 / 会话内跳转按钮 / XHSBatchTable 行点击 / 团队页运行 / TeamRunCard 查看详情）调用方式不变，各自成为画布上的一个节点。

## 2. 交互规格

| 操作 | 行为 |
|---|---|
| 滚轮 | 以指针为锚点缩放（scale 0.25–2，指数步进） |
| 拖拽空白 | 平移画布 |
| 拖拽节点头部 | 移动该节点（松手时持久化位置） |
| 「适配」按钮 | fitViewport：缩放平移到恰好包住全部节点（留边距） |
| 节点 ✕ | 移除该节点 |
| 面板 ✕ | 收起整个画布（节点保留，下次打开还原） |
| 新 surface 到来 | 作为新节点级联摆放并自动打开画布（沿用现有 auto-open 逻辑） |

## 3. 明确不做（v1 边界）

- **节点连线/工作流拖拽编排**：编辑语义此前已决策走表单/模板/compose；连线待影音创作 tab 需求明确后作为 S6 引入（画布容器已预留 children 分层）。
- **节点 resize / minimap / undo-redo**：参考项目有，v1 不做。
- **画布内容持久化**（A2UI messages 序列化）：onAction 是闭包，v1 只持久化位置与 viewport。

## 4. 落地记录（2026-07-03，v1 落地并真机验证）

- `apps/web/src/lib/canvas/infinite-canvas.tsx`（新）：零依赖 DOM 画布——`InfiniteCanvas`（wheel 指针锚点缩放 0.25–2 / 背景拖拽平移 / 节点头部拖拽移动 / 点状网格随 viewport 联动）+ 纯函数 `zoomAtPoint` / `fitViewport` / `clampScale` / `cascadePosition`（单测覆盖）+ `CanvasFitButton`。
- `a2ui-sidebar-context.tsx`：单 surface → **节点集合**。`openWith` 追加可选第 4 参 `{title}`，同 surfaceId 原地更新（全部旧调用点零改动兼容）；新增 `closeNode` / `moveNode` / `setViewport`；几何（viewport + 各 surface 位置）持久化 `nexu:canvas:sidebar`，内容（messages/onAction 含闭包）不持久化、由入口重开。
- `workspace-layout.tsx`：右侧栏渲染 `InfiniteCanvas`，头部「工作台 + 节点数 + 适配 + 关闭」；**显示条件去掉 `isSessionRoute` 限制**（修复：团队页 openWith 后侧栏不显示的 S1 漏洞），画布全工作区可用。
- 运行面板节点标题：TeamRunCard/团队页打开时传 `运行 · <标题>`；其余 surface 走 `humanizeSurfaceId` 兜底。
- 测试：`tests/infinite-canvas.test.tsx`（缩放锚点不动点/夹紧/适配/级联/渲染结构）；web 全套 109 通过。
- 真机：桌面端对话点「查看详情」→ 工作台画布展开，运行 DAG 以节点卡片呈现、状态点亮，网格/拖拽/缩放可用（截图验证）。

**后续（roadmap）：** S6 节点连线（影音创作编排需要时引入，画布已预留分层）；S7 影音创作 tab 复用同一容器挂图像/视频生成节点；节点 resize / minimap 视需求。

## 5. v2 —— 编排内核（2026-07-03，对齐参考项目画布区域）

深读本地 clone 的参考项目（`~/workspace/infinite-canvas`，AGPL，**仅提炼概念模型，零代码复用**；其画布同为手写 DOM + zustand，无画布库）后，将 v1「多节点摆放」升级为「可编排工作台」：

**架构（零新依赖）：**
- `lib/canvas/canvas-store.ts`（新）：仓库 xhs-batch-store 模式（`useSyncExternalStore`）的手写全局 store——类型化节点（`a2ui`/`text`/`image`：id/title/position/**size**/metadata）、`connections`（fromNodeId→toNodeId 自由连线）、`selectedNodeIds`/`selectedConnectionId`、viewport、`panelOpen`。**快照式 undo/redo**（400ms 防抖合并、50 条上限，对齐参考行为）。A2UI 载荷（messages+onAction 闭包）留在 store 外的 runtime Map，state 全量可 JSON 序列化。
- `infinite-canvas.tsx` 重写为 `CanvasSurface`（吃 store）：SVG 贝塞尔连线（右缘中点→左缘中点，拖蓝色手柄拉出虚线、落到目标节点创建；点击选中、双击删除）；右下角拖拽 **resize**；`⌘/Ctrl+拖拽` 框选（+Shift 追加）；快捷键 `⌘Z/⌘⇧Z/⌘Y/⌘A/Delete/Esc`；底部工具栏（撤销/重做｜文本/图片节点｜删除选中｜适配+缩放%｜清空），对齐参考项目工具栏并按 v2 范围裁剪。
- 节点内容：`text`（可编辑 textarea）、`image`（本地上传→dataURL 预览）、`a2ui`（既有全部组件经 payload map 渲染；载荷缺失显示"从原入口重开"占位）。
- `a2ui-sidebar-context.tsx` 降为**兼容桥**：`openWith` → `upsertA2UINode`（同 surfaceId 原地刷新），全部旧调用点零改动。
- 导入/导出：`nexu-canvas` v1 JSON（a2ui 节点及其连线剔除——闭包不可移植，由入口重开）。

**测试：** `tests/infinite-canvas.test.tsx` 11 例——缩放不动点/夹紧/按真实尺寸适配/贝塞尔路径；store 增删连（拒自连/重复边）/删点级联删边/undo-redo 快照/导出剔除 a2ui + 导入往返/upsert 幂等；Surface 渲染（节点/边/工具栏/选中态/过期占位）。web 全套 114 通过。

**v2 边界：** minimap、复制粘贴、多选整体拖动、素材库、外观面板、影音**生成**节点（S7，接 nexu 自有生成通道）、Agent 操控画布 op 协议（S8——参考项目的 add_node/connect_nodes/run_generation 等 8 op 面向本地 agent server；我们的对话流已天然充当 Agent 面板，op 通道未来经 A2UI action 回传承载）。HMR/刷新后画布节点为运行时态需从入口重开（几何持久化保留）。

## 6. v2.1 —— 验收反馈四项（2026-07-03）

1. **工具栏对齐参考项目**：新增 `video` / `audio` 节点类型（原生 `<video>/<audio>` 播放器渲染）+「上传素材」按钮（多选文件按 MIME 分流建 image/video/audio 节点，dataURL 内嵌）。仍未做：素材库、外观面板（记 roadmap）。
2. **一键展开 + 拖拽调宽**：工作台头部新增 Maximize/Minimize 切换——展开时右栏撑到「主区（对话流）恰好 500px」（`MAIN_MIN` 480→500），再点还原此前宽度；分割线拖拽原生支持保留，`RIGHT_SIDEBAR_MAX` 560→2400（实际上限交给 MAIN_MIN 约束）。
3. **团队运行 = 每步一个画布节点**：新增 `team-step` 节点类型（metadata 全可序列化：teamId/cardId/stepId/runId/workflowId/assigneeName/isApproval）。`pinTeamRunToCanvas(run)`（`lib/canvas/team-step-node.tsx`）把运行按拓扑 wave 展开为独立节点 + **真实画布连线**（dependsOn → connections），节点 id 派生自 cardId，重复打开幂等。节点内容轮询看板：状态徽章 / 产出预览 / 审批按钮（含审批步）。TeamRunCard「查看详情」与团队页「运行/最近运行」全部切到该入口；单面板 `buildRunPanelSurface` 移除（TeamRunPanel 组件保留供 a2ui 注册与 hooks 复用）。
4. **图片 → 小红书连线喂图**：`connection-effects.ts` —— 连线不只是视觉，携带数据流。image 节点（有内容）连入 XHS 编辑器 a2ui 节点时，从目标 surface 的 `XHSEditor` 组件 props 读取 batchId/postId，将图片推入 `xhs-batch-store` 对应帖子的 images（去重）。**生图节点（prompt→出图）需要 controller 新开生图 REST 通道（对接 openclaw image_generate），列为 S7 后端项**；届时生成节点复用同一 connection-effects 钩子。

测试：web 全套 115 通过（新增 pinTeamRunToCanvas 幂等/连线/布局断言 + 连线喂图去重断言）。

## 7. S7 —— 生图通道（2026-07-03 落地）

- **选型**：gateway 无直接图像 API（排除）；复用 §10.3 执行原语——`MediaGenerationService` 向 utility 子代理 lane（`agent:<botId>:subagent:imagegen-<uuid>`，botId=默认 agent）发一条严格合同消息（调 `image_generate` 一次、只回文件绝对路径、工具不可用则只回 `UNAVAILABLE`、禁 UI/技能/shell 变通），轮询 session 完成后提取路径。
- **安全**：路径必须落在 `<stateDir>/media` 内（防逃逸/防幻觉路径）+ 文件存在性校验；产物经既有 `GET /api/v1/media/state-file` 服务。
- **端点**：`POST /api/v1/media/generate-image {prompt} → {url, path}`（502 = 失败/超时/未配置后端）。
- **前端**：画布空图片节点新增「描述要生成的图片… + 生成」（与上传并列），成功后 `metadata.content = url`，可直接连线喂给 XHS 编辑器（复用 connection-effects）。
- **环境依赖与实测**：`image_generate` 工具需图像模型 provider 才注册；合入 main 的 **tabby-image 官方 skill**（走已登录 Tabby 云账号，零配置）后，生成合同更新为「优先 image_generate 工具 → 其次 tabby-image skill → 都不可用只回 UNAVAILABLE」。**真机全通**：POST 生图 108s 返回 200，产物 1536×1024 PNG 落 `media/outbound/<botId>/tabby-image/`，servable URL 直接可取（2.1MB）。超时上限 240s（skill 链路叠加 agent 开销：读 SKILL→起脚本→轮询）。弱模型可能无视 UNAVAILABLE 合同而空转至超时兜底。

## 8. v2.2 —— 交互内核重做：流畅度 + 划选文字 + 卡片对齐（2026-07-06 验收反馈）

验收反馈三项：拖动/改尺寸卡顿、拖动时鼠标划选文字、卡片样式与参考项目未对齐。逐项对齐参考项目范式（AGPL，仅借鉴范式，零代码复用）：

1. **划选文字**：画布容器永久 `select-none`（参考同款）；所有手势起点 `preventDefault()` + `setPointerCapture()`；文本节点 textarea 加 `select-text` 豁免（表单控件本身不受父级 user-select 影响，输入框选择不受损）。
2. **流畅度**（四个叠加根因一起修）：
   - **隐藏 bug**：旧 `onPointerMove` 回调身份依赖 viewport → 平移第一帧后 effect 清理把 window 监听器摘掉，平移基本冻结。重做后 window pointer 监听器**挂载期注册一次**，手势态全走 ref + `getCanvasState()` 读活值，身份零漂移。
   - **rAF 合帧**：pointermove 只记录坐标 + 调度一次 requestAnimationFrame，每帧至多一次 store 提交（参考同款）；pointerup 取消挂起帧并以松手坐标终提交。
   - **渲染隔离**：节点帧 `React.memo`（`CanvasNodeView`）+ 内容层 `NodeBody` 自定义比较（id/type/title/metadata 同一性）——拖动/缩放只重渲被拖节点的外框与连线 SVG，**A2UI 树/团队步骤内容零重渲**；节点定位从 `left/top` 改 `transform: translate3d` + `contain: layout style`（免每帧 layout）。
   - **store 侧**：`setViewport` 的 localStorage 持久化去抖 300ms（同步 I/O 出帧循环）；新增 `moveNodes()` 批量移动（多选拖动单次 emit），拖已选中节点整组移动、不再塌缩选区。
3. **卡片样式对齐参考**：`rounded-2xl border-2` + 选中蓝边升 `z-50` + `shadow-xl` + `transition-shadow 200ms`；连接点改为悬停/选中浮现的 12px 圆点（48px 隐形热区，hover scale-125）；缩放把手改角落 28px 隐形热区（光标即提示）；空媒体节点改居中图标砖 + 细字距标签（空图片/视频/音频节点）；有内容的图片/视频满铺圆角（p-0 full-bleed）、img `pointer-events-none select-none`；网格背景位置取模（数值不膨胀）。保留我们的标题栏（参考是无框卡片，但我们的节点含交互内容——A2UI 表单/文本编辑——需要专用拖拽把手与关闭钮）。

测试：新增 `moveNodes` 批量断言 + 「流畅交互契约」标记断言（容器 `select-none`、节点 `translate3d`/`contain`）；web 全套 115 通过、tsc/lint 干净。

## 9. Wave 1 —— 持久化 + 手感补全（2026-07-06 落地，SDD 流程）

执行计划 `specs/exec-plans/2026-07-06-canvas-parity-migration.md` 的 Wave 1（九项 1.1–1.9）全部落地。首次采用 superpowers **subagent-driven development** 流程：9 项编组为 6 个任务，每任务独立实现子代理 + 规格/质量双裁决评审 + 修复循环，收尾一次全波终审（最强模型），全程台账 `.superpowers/sdd/progress.md`。

**能力清单（全部真机可用）**：
1. **画布内容持久化**（IndexedDB `nexu-canvas/boards`，600ms 尾随去抖；a2ui 存框架、载荷重开重绑；水合不产生撤销步/不回存；StrictMode 安全）——刷新不再丢画布。
2. 文件拖放进画布（落点 world 坐标，多文件 +24 连续错位，读失败兜底不建节点）。
3. 系统剪贴板 Cmd+V（截图→图节点、文本→文本节点，落视口中心；输入框内不拦截）。
4. 节点复制/粘贴/副本（Cmd+C/V + 右键；选区内连线保留重映射；+36 逐次错位；`pasteClipboard(at)` 按组包围盒落点；**内部剪贴板优先、OS 粘贴兜底**单链路）。
5. 右键菜单（节点=副本/删除、连线=删除、背景=粘贴到此处；屏幕坐标钳位;任何手势起点统一关闭浮动菜单）。
6. 四角缩放 + 宽高比锁定（`canvas-geometry.ts` 纯函数:对角锚定含 min 钳位恒等式;图/视频默认锁比、头部锁钮切自由;比例=拖起时纵横比）。
7. 空格/中键平移（capture 相拦截,节点上也可平移;blur 防卡键）+ 缩放域 25%–200% → **5%–500%**（网格 <4px LOD 隐藏）。
8. 导出/导入 UI（JSON 下载/合并导入;**导入 id 全量重映射 + 端点校验 + surfaceId 剥离**——终审揪出的备份恢复损坏路径已封死）。
9. 连线落空白 → 建节点菜单（四类型,新节点左缘中点对齐落点并自动连线;`canvas-create.ts` 纯函数）。

**质量数据**：11 个 commit（6 feat + 5 修复轮）;web 测试 115 → **175**;5 个新纯模块（persistence/ingest/clipboard/create/geometry,全部 DOM-free 单测）;v2.2 交互契约终审逐条verified Held（mount-once/rAF 单帧单提交/memo 隔离/translate3d/select-none）;零新依赖零 any。

**W2 前置卫生任务（终审记录,不阻塞本波）**：内部剪贴板永久遮蔽 OS 粘贴需清空条件;FileReader→dataURL 三处重复提 `readFilesAsDataUrls()`;菜单钳位/关闭逻辑重复提共享 `FloatingMenu`;`onContextMenu` 缺 isEditableTarget 守卫;clipboard 的 genId 重复应导出 store 版;alert 换 AntD 提示;空格按住时节点上无光标反馈。`infinite-canvas.tsx` 1003→1521 行,架构仍清晰,W2 顺手抽 ~120 行重复。
