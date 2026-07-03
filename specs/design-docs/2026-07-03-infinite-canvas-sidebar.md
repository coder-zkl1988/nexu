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
- **环境依赖（实测发现）**：本地 dev 机未配置任何图像后端——`image_generate` 工具未注册（需要图像模型 provider），`liblib-ai-gen` skill 缺 API key。通道行为正确（请求→lane→轮询→502 优雅失败，单测 5 例覆盖提取/防逃逸/UNAVAILABLE 快速失败/超时），**生图成功路径需先配置图像后端**（图像模型 provider 或给 liblib skill 配 key）。弱模型可能无视 UNAVAILABLE 合同而空转至超时（120s 上限兜底）。
