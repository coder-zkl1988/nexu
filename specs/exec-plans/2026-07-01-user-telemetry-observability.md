# 用户端故障可观测性方案（2026-07-01）

## 背景

线上用户在**远程桌面端**和**手机端**遇到问题时，我们**拿不到任何日志**，无法定位原因。典型故障：

- 桌面端：点击「检查更新 / 自动更新」失败
- 手机端：执行任务时部分设备**黑屏**、部分设备**丢失无障碍权限**、VLM/任务失败

诉求：让「数据与隐私」里的采集能力真正覆盖这些故障，把用户端错误/日志收集回来分析。

## 现状核查结论（为什么现在收不到）

一句话：**当前的两个开关，对「远程收集故障」这个目标基本等于没有。** 逐项核查：

| 层面 | 结论 | 证据 |
|---|---|---|
| 使用分析（PostHog） | 开关真实、后端已接，但**只采集 `track()` 用户行为事件**，不采集错误/日志，排障用不上 | [main.tsx:35](../../apps/web/src/main.tsx#L35)；CI 注入 `POSTHOG_API_KEY`（desktop-release.yml:203） |
| 崩溃报告（Sentry）— DSN | **运行时 DSN 根本没注入**：发版 CI 只设 `SENTRY_AUTH_TOKEN`（build 时传 sourcemap），未设 `NEXU_DESKTOP_SENTRY_DSN` → `sentryDsn=null` → Sentry **在正式包里没启动** | [index.ts:341](../../apps/desktop/main/index.ts#L341) `if (sentryDsn)`；[runtime-config.ts:331](../../apps/desktop/shared/runtime-config.ts#L331) |
| 崩溃报告（Sentry）— 开关 | **纯装饰**：`onCheckedChange={setCrashReportsEnabled}` 只改本地 `useState`，不门控任何东西 | [models.tsx:687](../../apps/web/src/pages/models.tsx#L687)、[:1176](../../apps/web/src/pages/models.tsx#L1176) |
| 崩溃报告（Sentry）— 覆盖面 | 全库 **0 处 `captureException`** → 只能抓「未捕获的真崩溃」，**被 catch 处理掉的错误**（如更新失败弹 toast）看不到 | `grep captureException` = 0 |
| 手机端故障 | TabbyApp **没有任何错误上报 SDK**（Sentry/Crashlytics/Bugsnag 全无），黑屏 / 权限丢失连回传的路都没有 | `grep` TabbyApp = 0 |
| 日志上传 | 有「导出诊断」打包成 `tabby-diagnostics-*.zip`，但只是**本地保存对话框**，不上传 | [diagnostics-export.ts:720](../../apps/desktop/main/diagnostics-export.ts#L720) |

**核心误区**：「崩溃报告」≠「错误收集」。Sentry 默认只抓未捕获崩溃；而要排查的三类问题都是**被捕获处理掉的、或发生在另一个 App 上的**——必须在每个失败点**主动上报**才收得到。

## 目标 / 非目标

**目标**
- 桌面端的关键失败（更新、运行时、设备任务）能带上下文主动上报到统一后端。
- 手机端的黑屏 / 无障碍丢失 / 任务失败原因能回传到同一后端。
- 用户反馈问题时，可一键把日志（脱敏后）发给我们。
- 全程受用户同意开关门控，绝不泄露凭证。

**非目标**
- 不做完整 APM / 全链路性能追踪。
- 不做实时告警系统（先能收集、能查即可）。

## 落地方案（A → B → C 依次）

### 阶段 A：桌面端主动上报（基础设施 + 桌面故障）

**目标**：让 Sentry 在正式包真正启动、开关真正生效、关键失败点主动上报。这是 B/C 复用的地基。

- **A1 — 注入运行时 Sentry DSN**
  - GitHub 仓库加 secret `NEXU_DESKTOP_SENTRY_DSN`（用现有 Sentry 项目的 DSN）。
  - `desktop-release.yml` 的 mac + win build 步骤 `env:` 增加 `NEXU_DESKTOP_SENTRY_DSN: ${{ secrets.NEXU_DESKTOP_SENTRY_DSN }}`（`dist-mac.mjs` / `dist-win-stage.mjs` 已支持把它写进 build-config）。
  - 验收：装包后诊断里 `sentryMainEnabled=true`（[ipc.ts:420](../../apps/desktop/main/ipc.ts#L420)），或 Sentry 收到测试事件。

- **A2 — 崩溃报告开关接真**
  - 把 [models.tsx:687](../../apps/web/src/pages/models.tsx#L687) 的 `useState(true)` 改成读写 `crashReportsEnabled` 配置，链路参考现有 `analyticsEnabled`（config + IPC/mutation）。
  - Sentry 尊重同意：未同意时不 `init`（或 `beforeSend` 返回 `null`）；处理好首启默认值与同意时机。
  - 渲染进程若也有 Sentry，同样门控。

- **A3 — 关键失败点主动 `captureException`**
  - 封装统一 `reportError(err, { area, reasonCode, extra })`：内部尊重同意 + 脱敏 + 打 tag。
  - 接入点（按优先级）：
    1. 自动更新失败：`update-manager.ts` / `hooks/use-auto-update.ts` 的 catch。
    2. 被静默吞掉的运行时错误（本会话已发现过：VLM 凭证推送 `UNKNOWN_METHOD` 被 [device-control-service.ts:92](../../apps/controller/src/services/device-control-service.ts#L92) 静默吞掉）→ 关键处补上报。
    3. 设备任务错误：`device-control-service` / tabby-control RPC 错误路径。

- **A4 — 验收**：DSN 生效的包里，断网触发更新失败 → Sentry 有事件且带 `area/reasonCode/版本` 上下文；关开关后不再上报。

### 阶段 B：手机端故障回传（TabbyApp 直连 Sentry）

**目标**：手机侧故障（崩溃 / ANR / 黑屏 / 无障碍丢失 / 任务失败）直接上报 Sentry，不依赖 ws 链路与桌面在线。

> **2026-07-02 选型翻案**：原 relay 方案（TabbyApp → tabby-control → controller → SSE → 渲染 → IPC → 桌面 `reportError`）废弃，改为 TabbyApp 直连 Sentry Android SDK。原因：
> 1. relay 用被观测的链路传观测数据——App 崩溃 / 手机掉线时恰恰发不出去，覆盖面天然残缺；
> 2. Sentry Android SDK 自带崩溃/ANR/native crash 捕获 + 磁盘离线缓存补发，relay 结构上给不了；
> 3. relay 需要跨 3 个代码库的 5 跳链路，工程量大一个数量级。
>
> 原「统一后端 / 复用同意」两个理由的化解：同一 Sentry org 下新建 android 项目（按事件量计费，多项目零成本），跨端用 `deviceId` tag 关联；同意态沿 `device_set_vlm_credential` 既有 RPC 模式从桌面下发到手机。B1 已做的 `desktop:report-error` IPC 保留——桌面渲染进程自身错误仍走它，device_fault 不再借道。

- **B2 — TabbyApp 接 Sentry Android SDK**
  - `io.sentry:sentry-android` 依赖；DSN 经 BuildConfig 注入（DSN 可公开，直接进 APK；为空则不启动，与桌面 `sentryDsn=null` 行为一致）。
  - init 时打 tag：`deviceId`、`appVersion`、`model`；`beforeSend` 强制脱敏（VLM 凭证等绝不出设备）+ 同意门控。
- **B3 — 同意态下发**：桌面 `crashReportsEnabled` 变更/设备连接时，沿 `device_set_vlm_credential` 模式经 tabby-control 推给 TabbyApp；App 本地缓存，断线用最后已知值；默认与桌面一致（默认开）。
- **B4 — 检测点上报**（结构化 `faultType` tag）
  - 投屏黑屏：采集到持续全黑帧 / MediaProjection 失效。
  - 无障碍丢失：`AccessibilityService.onServiceDisconnected` / 权限自检失败。
  - 任务失败：复用现有 task-failure cause，作为结构化事件上报。
  - 崩溃 / ANR：SDK 自动捕获，无需手写。
- **B5 — 真机验收**：手机关掉无障碍 → Sentry android 项目收到事件且带 `deviceId`；断网触发故障 → 恢复网络后补发到达；关桌面同意开关 → 手机不再上报。

### 阶段 C：一键诊断上传

**目标**：用户反馈「更新失败了」时，能一键把日志发来，我们据引用 ID 直接拉取。

- **C1 — 复用诊断打包**：现有 zip（桌面日志 + controller/openclaw 日志 + `tabby-control-debug.log` + 脱敏 config + runtime-ports + diagnostics.json），可选附加手机最近日志。
- **C2 — 加「上传诊断」动作**：把 zip POST 到后端端点（或作为 Sentry event 附件），返回引用 ID 给用户复述。
- **C3 — 脱敏（硬性）**：上传前必须去除 bot token / apiKey / gateway token（AGENTS.md：never log credentials）。核查现有 export 是否已脱敏，缺则补。
- **C4 — 验收**：点「发送诊断」→ 后端收到 → 据引用 ID 可下载。

### 阶段 D：Session Replay（隐私优先，默认关）

**目标**：错误发生前后回放桌面 UI，直观看到用户操作路径（如「点检查更新 → 弹窗 → 报错」）。**仅桌面渲染进程，录不到手机**（手机故障仍靠 B）。

- **D1 — 渲染进程初始化 Sentry**：现有 Sentry 只在主进程；Session Replay 需在渲染进程（`@sentry/electron/renderer`）`init` + `replayIntegration()`。
- **D2 — 严格脱敏（硬性）**：`maskAllText` + `maskAllInputs` + block 敏感区块（BYOK apiKey / 云 token / 邮箱）。凭证绝不进回放。
- **D3 — 仅出错时录**：`replaysSessionSampleRate: 0` + `replaysOnErrorSampleRate: 1.0`（不随机录普通会话，对处理凭证的 app 更稳）。
- **D4 — 独立显式同意、默认关**：单独开关（不挂在崩溃报告下），属「含 PII」档。
- **D5 — 验收**：触发错误 → Sentry 有回放且敏感字段全被 mask。

## 进度与依赖

- **阶段 A：✅ 已落地并验证**（v0.5.11 — DSN 注入、同意开关接真、`reportError` 已接自动更新失败点；Sentry 实测收到了更新失败事件）。
- **阶段 B：代码已落地（2026-07-02，直连方案），待真机验收**。TabbyApp 接 `io.sentry:sentry-android:8.46.0`（`TabbyTelemetry` 统一入口，DSN 已填 gradle.properties，android 项目 `4511663459598336`）；检测点：`accessibility_lost`（onUnbind）/ `task_failure`（无障碍不可用、凭证缺失、error/stuck 结果）/ `black_screen`（连续 3 帧全黑抽样 + 连续 3 次帧超时）。同意态链路：desktop `ipc.ts` PATCH → controller `/api/internal/desktop/preferences`（configStore 持久化镜像 + `pushTelemetryConsent`）→ tabby-control `device_set_telemetry_consent` RPC（`connected` envelope 广播 + 握手补推）→ TabbyApp SharedPreferences 缓存 + `beforeSend` 门控。
- **阶段 C：✅ 代码已落地**。`uploadDiagnostics()`（diagnostics-export.ts）复用脱敏归档 → Sentry event 附件（≤19MB），Help 菜单「Send Diagnostics to Support…」返回 referenceId。
- **阶段 D：✅ 代码已落地**。渲染进程 Sentry init（原已存在）按 `sessionReplayEnabled` shell preference（默认关）挂 `replayIntegration`（maskAllText + maskAllInputs + blockAllMedia，session 采样 0 / onError 1.0）；设置页「出错时回放录制」开关，重启后生效。
- 顺序：`A ──▶ B ──▶ C ──▶ D`。B/C/D 全部复用 A 的 `reportError` / 同意开关 / 脱敏。
- **选型决定**：
  - **B = TabbyApp 直连 Sentry Android SDK**（2026-07-02 翻案，原 relay 方案废弃，理由见阶段 B）；同意态经 tabby-control RPC 下发。
  - **C = Sentry event 附件**：复用现有 DSN，不新建后端。
  - **D = 隐私优先**：渲染进程 init + 全 mask + 仅出错时录 + 独立同意（默认关）。

## 隐私与合规

- 所有上报（A/B/C）均受同意开关门控；区分两档：**匿名遥测/错误**（可默认开）vs **含日志/PII 的诊断上传**（必须显式点按）。
- 统一脱敏：凭证、token、密钥一律不出设备。
- 更新「数据与隐私」文案，明确说明各档采集了什么（现文案过于笼统）。

## 成功指标

- 桌面端：一次真实的「自动更新失败」能在后端查到，带足够上下文定位到原因。
- 手机端：黑屏 / 无障碍丢失能在后端按 `deviceId` 聚合查看。
- 支持链路：用户反馈问题 → 5 分钟内我方能据引用 ID 拿到该用户的完整日志包。

## 已决定（原开放问题）

1. ✅ Sentry 项目 `o4508902319325184`；运行时 DSN 存 GitHub secret `NEXU_DESKTOP_SENTRY_DSN`，发版 CI 注入 mac+win build。
2. ✅ C 用 **Sentry event 附件**（复用现有 DSN，不新建后端）。
3. ✅ B 用 **TabbyApp 直连 Sentry Android SDK**（2026-07-02 推翻原 relay 决定：relay 用被观测链路传观测数据，覆盖不了崩溃/掉线；SDK 自带崩溃捕获 + 离线缓存）。同 org 新建 android 项目，`deviceId` tag 跨端关联，同意态经 RPC 下发。
4. ✅ 错误/崩溃默认开；诊断上传（C）+ Session Replay（D）默认关且需显式同意。
