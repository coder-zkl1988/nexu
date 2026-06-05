# Plan: LobsterAgentAndroid 提示词与动作定义改进

**Status**: v4（重写：基于 OpenClaw 决策层架构）
**Date**: 2026-04-29
**Scope**: `~/workspace/LobsterAgentAndroid` + `~/workspace/openclaw-lobster-device-control`
**参考资料**：`~/workspace/Open-AutoGLM`、`~/workspace/mobile-glm`

---

## 1. 架构全景

```
┌─────────────────────────────────────────────────────┐
│  OpenClaw Agent (AI 决策层)                          │
│  ├─ system prompt: "你是手机自动化助手..."            │
│  ├─ 工具: device:execute_task / device:list / ...    │
│  └─ 决策: 分析任务 → 拆分步骤 → 下发手机 → 处理结果   │
└──────────────────────┬──────────────────────────────┘
                       │ plugin API
┌──────────────────────▼──────────────────────────────┐
│  lobster-device-control 插件 (OpenClaw ↔ 手机桥梁)    │
│  ├─ TaskCoordinator: executeTask() → Promise<TaskResult>
│  ├─ onProgress(): 步骤进度回调                         │
│  └─ 工具定义: device:list / execute_task / ...        │
└──────────────────────┬──────────────────────────────┘
                       │ WebSocket (port 18800)
┌──────────────────────▼──────────────────────────────┐
│  LobsterAgentAndroid (手机端 VLM 执行器)              │
│  ├─ AgentForegroundService: WS 连接 + 任务调度         │
│  ├─ PhoneAgentRunner: VLM 循环 (截图→分析→执行→重复)  │
│  │   ├─ ActionParser: 解析 VLM 输出 → DeviceAction    │
│  │   ├─ ActionHandler: 执行动作 + fallback            │
│  │   └─ PromptManager: 构建 VLM 系统提示词              │
│  └─ TerminalFragment: 本地操作 UI                     │
└─────────────────────────────────────────────────────┘
```

### 谁做决策？

| 层 | 角色 | 类比 |
|---|---|---|
| **OpenClaw Agent** | 任务规划、拆分、错误恢复、Interact 响应 | mobile-glm 的 Claude Agent SDK |
| **LobsterAgentAndroid** | 单步 UI 操作执行（VLM 截图→动作） | mobile-glm 的 AutoGLM 执行器 |
| **lobster-device-control 插件** | 连接桥梁、协议适配 | — |

---

## 2. 审计结论

已有三个项目代码的全面阅读，以下将原始 plan 中的 item 逐一判定：

| 原始计划声明 | 实际代码 | 判定 |
|---|---|---|
| "日志格式不一致，缺少步骤编号、动作类型、耗时" | `PhoneAgentRunner.kt` 已有 `🤖 Step N`、`⏱ VLM 响应耗时: Xms`、`▶ 执行动作: Tap(...)` | **跳过** |
| "ActionHandler 日志只在 logcat" | `PhoneAgentRunner.log()` 已双写 logcat + UI（`onLog` 回调） | **跳过** |
| "没有显式步骤进度" | `stepCount` 已每步输出，WebSocket 有 `agent.progress` 推送 | **跳过** |
| "坐标换算示例缺失" | prompt 规则 4 + 14 已覆盖归一化坐标（0-999） | **跳过** |
| "ShizukuController" | 代码库中实际是 `AccessibilityDeviceController` + `LadbDeviceController` | **跳过**（不存在此类） |
| "finish → 中文" | 会破坏 `ActionParser.parseDoAction()` 的 regex 解析，且 Open-AutoGLM / mobile-glm 都用 `finish` | **跳过** |
| `Type` / `Type_Name` 语义重复 | prompt 描述不同但 `ActionParser.kt:410` 映射到同一 `DeviceAction.InputText`；mobile-glm 的 `ACTION_REGISTRY` 不包含 `Type_Name` | **保留** |
| `Interact` 只是 `delay(5s)` | 确实，没有给 OpenClaw 介入的机会 | **保留** |
| 提示词缺少错误恢复模式 | prompt 规则 21-24 已有基础覆盖，但缺少具体场景的**状态转换示例** | **保留**（增强） |
| 提示词缺少职责边界 | mobile-glm 有 `【你负责的】/【你不负责的】` 声明，LobsterAgentAndroid 没有 | **保留**（新增） |

---

## 3. 实际改动

### 3.1 PromptManager.kt（仅提示词）

**文件**：`app/src/main/kotlin/com/lobster/agent/config/PromptManager.kt`

**改动内容**：

#### A. 新增职责边界（prompt 开头，日期之后）

参考 mobile-glm `_build_system_prompt()`：

```
## 你的职责边界

【你负责的】手机屏幕上的所有操作：
- 打开应用、点击按钮、滑动屏幕、输入文字
- 多步骤的手机操作流程
- 从屏幕上获取信息（阅读消息、查看页面内容）
- 处理弹窗、权限请求等 UI 交互

【你不负责的】需要外部知识的决策：
- 网络搜索、外部信息查询
- 复杂的内容分析和推荐
- 需要专业领域知识的判断

遇到不确定的情况，使用 Interact 向编排层请求指导。
```

#### B. 新增状态转换章节

```
## 常见状态转换模式

### 弹窗处理
发现非预期弹窗 → 判断类型（广告/权限/确认）→ 关闭/允许/拒绝 → 确认返回原页面

### 加载等待
页面持续加载 → 最多 Wait 3 次（每次 3 秒）→ 仍未加载则 Back 返回后重新进入

### 权限请求
系统权限弹窗 → 若任务需要则"允许"，不需要则"拒绝"

### 页面无变化恢复
操作后截图相同 → 微调坐标重试（x±50）→ 2 次仍无效 → 尝试不同动作类型

### 搜索失败恢复
搜索无结果 → 简化关键词 → 仍无结果 → 返回上一级换入口 → 3 次失败 → finish
```

#### C. 合并 `Type`/`Type_Name`

删除 `Type_Name` 的定义段落，将 `Type` 的描述增强：

```
- do(action="Type", text="xxx")
  在当前聚焦的输入框中输入文本。输入前确保已点击输入框使其获得焦点。
  （也接受 Type_Name，效果相同）
```

#### D. 更新 `Interact` 描述

```
- do(action="Interact", message="xxx")
  当需要编排层做出选择时使用（如面对多个选项不确定、需要确认敏感操作）。
  使用此动作会暂停执行，由编排层决策后恢复。
```

#### E. Bump 版本号

```kotlin
private const val CURRENT_PROMPT_VERSION = 4  // was 3
```

---

### 3.2 PhoneAgentRunner.kt（Interact 改为挂起等待 + WS 通知）

**文件**：`app/src/main/kotlin/com/lobster/agent/agent/PhoneAgentRunner.kt`

**改动**：Interact 不再 `delay(5s)+continue`，改为：
1. 通过 WS `agent.progress` 发送交互请求给 OpenClaw
2. 挂起循环，等待 OpenClaw 下发带 `guidance` 的新任务来恢复

```
当前行为：
   VLM → Interact → delay(5000) → 自动继续（OpenClaw 完全不知道）

改为：
   VLM → Interact
        → 发送 progress { interaction_request: { message, screenshot, step } }
        → 挂起循环（Coroutine suspend）
        → OpenClaw 收到 progress → 分析截图 → 决策
        → OpenClaw 调用 device:execute_task(sessionId=..., guidance="用户的选择是...")
        → AgentForegroundService 收到 guidance → 注入 conversationHistory
        → 恢复挂起的循环
```

**具体代码改动**：

```kotlin
// === 新增成员 ===
private var _interactionContinuation: CancellableContinuation<String?>? = null
private var _interactionTaskId: String? = null  // 用于 WS progress 绑定

// === 新增挂起方法 ===
private suspend fun awaitInteractionGuidance(): String? {
    return suspendCancellableCoroutine { cont ->
        _interactionContinuation = cont
    }
}

// 供 AgentForegroundService 调用（收到 guidance 后恢复循环）
fun resumeWithGuidance(guidance: String) {
    _interactionContinuation?.resume(guidance)
    _interactionContinuation = null
}
```

```kotlin
// === 修改 Interact 处理（替换 L362-368）===
"interact" -> {
    val msg = parsed.params["message"]?.toString() ?: "需要编排层决策"
    log("W", "⏸ Interact [Step $stepCount]: $msg — 等待 OpenClaw 决策")

    // 通过 progress 通道发送交互请求（携带截图）
    val screenshot = captureScreen()?.bytes
    wsClient.sendInteractionRequest(
        taskId = _interactionTaskId ?: taskId,
        message = msg,
        step = stepCount,
        screenshot = screenshot
    )

    // 挂起，等待 OpenClaw 下发 guidance 来恢复
    val guidance = awaitInteractionGuidance()
    if (guidance != null) {
        log("I", "👤 OpenClaw 指导: $guidance")
        addToHistory("user", "[编排层指导]\n$guidance")
    } else {
        log("I", "⏱ 超时未收到指导，自动继续")
    }
    continue
}
```

---

### 3.3 WsMessage.kt / WsClient.kt（新增 interaction_request 消息类型）

**文件**：`app/src/main/kotlin/com/lobster/agent/ws/WsMessage.kt`
**文件**：`app/src/main/kotlin/com/lobster/agent/ws/WsClient.kt`

**改动**：

1. `WsMessage.kt` 新增出站消息构建器：

```kotlin
fun buildInteractionRequest(
    taskId: String,
    message: String,
    step: Int,
    screenshot: ByteArray? = null
): String = JSONObject().apply {
    put("channel", "task")
    put("method", "agent.progress")
    put("params", JSONObject().apply {
        put("taskId", taskId)
        put("step", step)
        put("action", "Interact")
        put("progressPercent", 0)
        put("thinking", "")
        put("interaction_request", JSONObject().apply {
            put("message", message)
            screenshot?.let {
                put("screenshot", Base64.encodeToString(it, Base64.NO_WRAP))
            }
        })
    })
}.toString()
```

2. `WsClient.kt` 新增方法：

```kotlin
fun sendInteractionRequest(
    taskId: String,
    message: String,
    step: Int,
    screenshot: ByteArray? = null
) {
    sendRaw(buildInteractionRequest(taskId, message, step, screenshot))
}
```

---

### 3.4 AgentForegroundService.kt（处理 guidance 恢复任务）

**文件**：`app/src/main/kotlin/com/lobster/agent/service/AgentForegroundService.kt`

**改动**：在 `handleTask()` 中，当收到带 `sessionId` + `guidance` 的 `agent.execute` 消息时，不走 `phoneAgentRunner.executeTask()` 新建任务，而是调用 `phoneAgentRunner.resumeWithGuidance(guidance)` 来恢复挂起的循环：

```kotlin
// handleTask() 中新增分支（在现有 executeTask 之前）
if (sessionId != null && guidance != null && phoneAgentRunner.isTaskRunning()) {
    // 这是恢复指令：OpenClaw 对 Interact 的响应
    Log.i(TAG, "Resuming task with guidance: $guidance")
    phoneAgentRunner.resumeWithGuidance(guidance)
    respondCallback("Guidance received", null)
    return
}
```

这需要 `PhoneAgentRunner` 暴露出 `isTaskRunning()` 和当前 `taskId`：

```kotlin
// PhoneAgentRunner 新增
fun getCurrentTaskId(): String? = currentTaskId
```

---

### 3.5 插件端：protocol.ts（扩展协议）

**文件**：`~/workspace/openclaw-lobster-device-control/src/protocol.ts`

**改动**：

1. `ExecuteParamsSchema` 新增 `guidance` 和 `sessionId`：

```typescript
export const ExecuteParamsSchema = z.object({
  taskId: TaskIdSchema,
  task: z.string().min(1),
  mode: z.enum(['autonomous']).default('autonomous'),
  guidance: z.string().optional(),       // 新增
  sessionId: z.string().optional(),      // 新增
  maxSteps: z.number().int().optional(), // 新增
});
```

2. `AgentProgressParamsSchema` 新增 `interaction_request`：

```typescript
export const AgentProgressParamsSchema = z.object({
  taskId: TaskIdSchema,
  step: z.number().int().min(1),
  action: z.string(),
  target: z.string().optional(),
  progressPercent: z.number().min(0).max(100),
  thinking: z.string().optional(),
  screenshot: z.string().optional(),
  interaction_request: z.object({        // 新增
    message: z.string(),
    screenshot: z.string().optional(),
  }).optional(),
});
```

---

### 3.6 插件端：task-coordinator.ts（转发交互请求）

**文件**：`~/workspace/openclaw-lobster-device-control/src/task-coordinator.ts`

**改动**：

1. `executeTask()` 支持 `guidance` 和 `sessionId` 参数传递给手机：

```typescript
async executeTask(
  deviceId: string,
  task: string,
  timeoutMs = 300_000,
  guidance?: string,      // 新增
  sessionId?: string,     // 新增
): Promise<TaskResult> {
  // ...
  const sent = this.wsServer.sendToDevice(deviceId, {
    channel: 'task',
    id: taskId,
    method: 'agent.execute',
    params: { taskId, task, mode: 'autonomous', guidance, sessionId },
  });
  // ...
}
```

2. `handleTaskMessage()` 中增加 `interaction_request` 处理（在 `agent.progress` 分支中）：

```typescript
// 在 agent.progress 分支中新增
const interactionRequest = params.interaction_request as { message: string; screenshot?: string } | undefined;
if (interactionRequest) {
  // 保存截图到文件
  if (interactionRequest.screenshot) {
    const buffer = Buffer.from(interactionRequest.screenshot, 'base64');
    const filePath = join(SCREENSHOT_DIR, `interaction_${taskId}_step${params.step}.webp`);
    fs.writeFileSync(filePath, buffer);
    interactionRequest.screenshot = filePath;
  }
  // 通过 IPC 通知 OpenClaw（会在 tools.ts 中作为 step 事件体现）
  this.ipcNotifier('device:interaction_request', {
    deviceId,
    taskId: params.taskId,
    step: params.step,
    screenshot: interactionRequest.screenshot,
    message: interactionRequest.message,
  });
}
```

---

### 3.7 插件端：tools.ts（工具描述更新）

**文件**：`~/workspace/openclaw-lobster-device-control/src/tools.ts`

**改动**：`device:execute_task` 工具描述中新增 `guidance` 参数说明：

```typescript
parameters: {
  type: 'object',
  properties: {
    deviceId: { /* ... */ },
    task: { /* ... */ },
    guidance: {
      type: 'string',
      description: '当 VLM 输出 Interact 请求指导时，用此字段传递决策/指令来恢复任务',
    },
    sessionId: {
      type: 'string',
      description: '任务会话 ID，用于恢复之前暂停的任务',
    },
  },
  required: ['deviceId', 'task'],
},
```

同时在工具 description 中添加 Interact 处理说明：

```
When the device reports an "Interact" status (needs your decision),
you will receive it via an interaction_request event. You should:
1. Analyze the screenshot if available
2. Make a decision
3. Call device:execute_task with sessionId + guidance to resume
```

---

### 3.8 插件端：tools.ts（OpenClaw system prompt 补充）

**文件**：`~/workspace/openclaw-lobster-device-control/src/tools.ts`

在 `device:execute_task` 的 `description` 中补充 OpenClaw 的 Interact 处理逻辑：

```
## Handling Interact Events

The device VLM may output Interact when it needs your decision. When this happens:
1. You'll receive an interaction_request with a screenshot and message
2. Analyze the screenshot to understand the current state
3. Make a decision and call device:execute_task with:
   - The same sessionId
   - Your decision/instruction as the guidance parameter
   - The original task as the task parameter
```

---

## 4. 不修改的文件

| 文件 | 原因 |
|---|---|
| `ActionHandler.kt` | logcat 日志属于内部实现，action 结果已通过 `PhoneAgentRunner.log()` 双写到 UI |
| `ActionParser.kt` | `Type`/`Type_Name`/`type_name` 已在 L410 归一化，无需额外改动 |
| `TerminalFragment.kt` | 本地弹窗方案已放弃，Interact 由 OpenClaw 决策 |
| `LobsterAgentApplication.kt` | 不再需要暴露 `phoneAgentRunner` 引用 |
| `ConnectionManager.kt` | 无需感知 Interact 状态 |
| `AccessibilityDeviceController.kt` / `LadbDeviceController.kt` | 与本次改动无关 |

---

## 5. 改动总览

| 代码库 | 文件 | 改动 |
|---|---|---|
| LobsterAgentAndroid | `PromptManager.kt` | 职责边界 + 状态转换 + Type 合并 + Interact 描述 + version bump |
| LobsterAgentAndroid | `PhoneAgentRunner.kt` | Interact: `delay(5s)` → 挂起等待 OpenClaw guidance |
| LobsterAgentAndroid | `WsMessage.kt` | 新增 `buildInteractionRequest()` |
| LobsterAgentAndroid | `WsClient.kt` | 新增 `sendInteractionRequest()` |
| LobsterAgentAndroid | `AgentForegroundService.kt` | 收到 guidance 时恢复挂起的循环 |
| lobster-device-control | `protocol.ts` | `ExecuteParams` 加 `guidance`/`sessionId`/`maxSteps`；`AgentProgressParams` 加 `interaction_request` |
| lobster-device-control | `task-coordinator.ts` | 转发 `interaction_request`；`executeTask()` 传递 `guidance`/`sessionId` |
| lobster-device-control | `tools.ts` | 工具描述更新，OpenClaw 侧 Interact 处理指引 |

**文件数**：Android 5 个 + 插件 3 个 = **8 个**

---

## 6. 验证方式

### 6.1 Android 端

```bash
cd ~/workspace/LobsterAgentAndroid
./gradlew :app:assembleDebug
```

1. **Prompt 迁移**：安装后检查 SharedPreferences 中 `prompt_version` = 4
2. **Type_Name 兼容**：发送含 `do(action="Type_Name", text="test")` 的任务，确认正常执行
3. **Interact 流程**（需插件配合）：
   - 发送可能触发 VLM 输出 Interact 的任务（如"在搜索结果中选一个"）
   - 检查 logcat 输出 `⏸ Interact [Step X]: ... — 等待 OpenClaw 决策`
   - 确认 WS 发出 `agent.progress` 消息含 `interaction_request` 字段
   - 确认 OpenClaw（或其他 WS 客户端）下发带 `guidance` 的新 execute 后，循环恢复

### 6.2 插件端

```bash
cd ~/workspace/openclaw-lobster-device-control
npm run build
```

1. **协议兼容**：旧版手机（不发送 `interaction_request`）的 progress 消息仍正常处理
2. **interaction_request 转发**：收到含 `interaction_request` 的 progress 时，IPC 通知正常触发
3. **guidance 参数**：`executeTask()` 接收并正确封装 `guidance` 和 `sessionId` 到 WS 消息

---

## 7. 风险评估

| 风险 | 缓解 |
|---|---|
| 提示词变长约 +500 tokens | 状态转换 + 职责边界减少 VLM 无效重试，净节省 token |
| VLM 对新 prompt 行为变化 | 先在 1 台设备验证再推广 |
| 插件协议变更影响旧版 Android 端 | `guidance`/`sessionId`/`interaction_request` 均为 optional 字段，旧版不传则插件按现有逻辑处理 |
| OpenClaw 未及时响应 Interact 导致挂起 | `awaitInteractionGuidance()` 加 60s 超时，超时后自动 continue |
| 挂起期间设备被标记 busy | 正常——Interact 是任务的一部分，不是任务结束 |

---

## 8. 与 mobile-glm 的对齐点

| mobile-glm 模式 | LobsterAgentAndroid 对应实现 |
|---|---|
| Claude Agent SDK 收到 `needs_interaction` | OpenClaw 收到 `interaction_request` 事件 |
| Claude SDK 分析截图 + 决策 | OpenClaw 分析 `interaction_request.screenshot` + 决策 |
| Claude SDK 调用 `phone_task(session_id=..., guidance=...)` 恢复 | OpenClaw 调用 `device:execute_task(sessionId=..., guidance=...)` 恢复 |
| `_build_system_prompt()` 职责边界声明 | `PromptManager` 新增职责边界章节 |
| `ACTION_REGISTRY` 不包含 Type_Name | Prompt 合并 Type/Type_Name |
