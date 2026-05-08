# 定时任务集成到 OpenClaw 方案

**日期**: 2026-05-08
**状态**: 设计中
**负责人**: 待定

---

## 1. 背景

当前 Nexu 系统中：
- OpenClaw 已有 `cron` 配置项（`cron: { enabled: true }`）和 `gateway.tools.allow: ["cron"]`
- 这是 **agent 侧的 cron tool** — agent 在对话中调用它来给自己设定时任务，不是用户主动配置的调度
- NexuConfig store 没有 cron schedule 数据模型
- Controller 没有 cron 管理 API 或服务
- 前端自动化页面使用 mock 数据

---

## 2. 目标

将用户在前端创建的定时任务（scheduled tasks）应用到 OpenClaw runtime，使定时任务能够真正执行。

---

## 3. 方案：NexuConfig 存储调度 → Workspace 模板注入 → Agent Cron Tool 注册

**核心思路**：不在 controller 层自建调度引擎，复用 OpenClaw 已有的 cron tool。用户配置定时任务 → 存入 NexuConfig → config compiler 将 schedule 写入 agent workspace 模板 → agent 启动时读取并使用 cron tool 注册定时执行。

### 3.1 数据流

```
用户 UI 创建定时任务
  → Controller API 存储到 NexuConfig (新增 schedules 字段)
  → Config compiler 将 schedule 写入 agent workspace 模板
  → Agent 启动时读取 workspace，通过 cron tool 注册定时任务
  → Cron 触发时 agent 收到消息，执行对应 prompt
```

### 3.2 NexuConfig Schema 扩展

在 `apps/controller/src/store/schemas.ts` 的 `nexuConfigObjectSchema` 中新增 `schedules` 字段：

```ts
export const scheduleSchema = z.object({
  id: z.string(),           // cuid2
  botId: z.string(),        // 关联的 agent
  name: z.string(),         // 定时任务名称
  cron: z.string(),         // cron 表达式 (e.g. "0 9 * * *")
  timezone: z.string().default("UTC"),
  prompt: z.string(),       // 触发时发给 agent 的 prompt
  enabled: z.boolean().default(true),
  createdAt: z.string(),
  updatedAt: z.string(),
});

schedules: z.array(scheduleSchema).default([])
```

### 3.3 Controller API

在 `apps/controller/src/routes/` 新增 schedules 路由：

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/schedules` | 列出所有定时任务 |
| POST | `/api/v1/schedules` | 创建定时任务 |
| PUT | `/api/v1/schedules/:id` | 更新定时任务 |
| DELETE | `/api/v1/schedules/:id` | 删除定时任务 |
| POST | `/api/v1/schedules/:id/run` | 立即执行一次 |

### 3.4 OpenClaw Config Compiler 改动

在 `apps/controller/src/lib/openclaw-config-compiler.ts` 的 `compileAgentList` 阶段，为每个 agent 注入 schedules 信息到 workspace 模板：

```ts
// compileAgentList 中，为每个 bot 关联的 schedule 生成 BOOTSTRAP.md 内容片段
function buildScheduleBootstrapSection(schedules: Schedule[]): string {
  if (schedules.length === 0) return "";
  const lines = ["## Scheduled Tasks", ""];
  for (const s of schedules) {
    if (!s.enabled) continue;
    lines.push(`- **${s.name}** (${s.cron}, ${s.timezone}): ${s.prompt}`);
  }
  return lines.join("\n");
}
```

生成的 workspace 文件内容通过 `WorkspaceTemplateWriter` 写入。

### 3.5 Agent 侧行为

Agent 在 `BOOTSTRAP.md` 中收到定时任务描述，通过 OpenClaw 内置的 `cron` tool 注册定时任务：

```
## Scheduled Tasks
You have the following scheduled tasks. Use the `cron` tool to register them on startup:
- **Daily Report** (0 9 * * *, UTC): Generate and send the daily analytics report
- **Weekly Cleanup** (0 2 * * 0, UTC): Clean up expired sessions and temp files
```

Agent 解析这些信息，调用 `cron` tool 注册后，OpenClaw 会按 cron 表达式触发 agent 执行。

---

## 4. 运行历史记录

### 4.1 记录方式

Agent 执行定时任务后，将结果写入 session 或 artifact。Controller 通过查询 session/artifact API 获取运行历史。

### 4.2 前端展示

前端自动化页面详情展开区域展示最近 5 条运行历史（时间、成功/失败、耗时）。

---

## 5. 前端页面改造（已完成）

- 卡片网格 → 可展开列表 (`task-history-page.tsx` 模式)
- 新建/编辑弹窗（参考竞品设计）
- i18n 支持

---

## 6. 优势

1. **不复造轮子** — 复用 OpenClaw cron tool，不自建调度引擎
2. **天然多租户隔离** — schedule 与 agent 绑定
3. **零新增 runtime writer** — 利用现有 workspace 模板机制
4. **Agent 能力完整** — agent 有完整的 context 和 skill 来执行定时任务

---

## 7. 限制与风险

1. **依赖 OpenClaw 进程** — 定时任务执行依赖 OpenClaw 进程持续运行（桌面端通过 launchd 保证）
2. **Agent 侧实现** — Agent 需要正确解析 workspace 中的 schedule 信息并调用 cron tool
3. **运行历史延迟** — 需要 agent 侧配合记录运行结果

---

## 8. 实施步骤

### Phase 1: 前端（已实施）
- [x] 列表布局改版
- [x] 展开详情区域
- [x] 新建/编辑弹窗
- [x] i18n

### Phase 2: 后端 Schema & API（待实施）
- [ ] NexuConfig schema 新增 schedules 字段
- [ ] Controller API 实现 CRUD routes
- [ ] OpenAPI spec 生成

### Phase 3: Config Compiler 集成（待实施）
- [ ] Workspace 模板注入 schedules 信息
- [ ] Agent 侧 cron tool 集成确认

### Phase 4: 运行历史（待实施）
- [ ] Agent 侧运行结果记录
- [ ] Controller API 查询运行历史
- [ ] 前端展示运行历史

---

## 9. 参考文件

- `apps/controller/src/lib/openclaw-config-compiler.ts` — Config 编译
- `apps/controller/src/store/schemas.ts` — NexuConfig schema
- `packages/shared/src/schemas/openclaw-config.ts` — OpenClaw config schema
- `specs/references/openclaw-config-schema.md` — OpenClaw config 参考
- `apps/web/src/pages/automations.tsx` — 前端自动化页面
