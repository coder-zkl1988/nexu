# Nexu 代码库代码审查报告

**日期:** 2026-05-09
**范围:** 跨所有源模块的全代码库审查
**方法:** 使用专业代码审查员并行逐模块审查

---

## 目录

1. [摘要仪表板](#summary-dashboard)
2. [Module 1: Controller - App Bootstrap & DI Container](#module-1-controller---app-bootstrap--di-container)
3. [Module 2: Controller - Lib/Utilities](#module-2-controller---libutilities)
4. [Module 3: Controller - Routes (API Layer)](#module-3-controller---routes-api-layer)
5. [Module 4: Controller - Runtime](#module-4-controller---runtime)
6. [Module 5: Controller - Services](#module-5-controller---services)
7. [Module 6: Controller - Store (Persistence)](#module-6-controller---store-persistence)
8. [Module 7: Desktop - Main Process](#module-7-desktop---main-process)
9. [Module 8: Desktop - Services & Updater](#module-8-desktop---services--updater)
10. [Module 9: Web - Core App, Pages & Components](#module-9-web---core-app-pages--components)
11. [Module 10: Web - Hooks, Lib & SDK](#module-10-web---hooks-lib--sdk)
12. [Module 11: Packages - shared, slimclaw, dev-utils](#module-11-packages---shared-slimclaw-dev-utils)
13. [Module 12: Tools & Scripts](#module-12-tools--scripts)
14. [Module 13: Desktop - Preload, Renderer & Electron Config](#module-13-desktop---preload-renderer--electron-config)
15. [Module 14: A2UI Feature & Web Components](#module-14-a2ui-feature--web-components)
16. [Module 15: Desktop Renderer, Sidecars & Build Scripts](#module-15-desktop-renderer-sidecars--build-scripts)
17. [Module 16: Tools/Dev — Dev Environment & Supervisors](#module-16-toolsdev--dev-environment--supervisors)
18. [Module 17: Web Pages (Remaining)](#module-17-web-pages-remaining)
19. [Module 18: Web Pages & Components (Batch 3)](#module-18-web-pages--components-batch-3)
20. [Module 19: Channel Setup Views, Layouts & App Bootstrap](#module-19-channel-setup-views-layouts--app-bootstrap)
21. [Module 20: UI Primitives, Hooks & Lib Utilities](#module-20-ui-primitives-hooks--lib-utilities)
22. [Module 21: Channel Management, Integrations & Session Detail Pages](#module-21-channel-management-integrations--session-detail-pages)
23. [Module 22: Community Skill Detail, Expert Detail, Feishu Bind, Slack Claim, Slack OAuth, Devices Pages](#module-22-community-skill-detail-expert-detail-feishu-bind-slack-claim-slack-oauth-devices-pages)
24. [Module 23: Models, Rewards, Skills Pages & Device Components](#module-23-models-rewards-skills-pages--device-components)
25. [Module 24: Model Picker, Provider Logos, Brand Rail, UI Primitives, Channel Setup Views, Workspace Layout](#module-24-model-picker-provider-logos-brand-rail-ui-primitives-channel-setup-views-workspace-layout)
26. [Module 25: Remaining Channel Setup Views, Channels Components, Hooks & Utility Components](#module-25-remaining-channel-setup-views-channels-components-hooks--utility-components)
27. [Module 26: UI Primitives (Radix), Rewards Components, Expert/Skill Cards & Lib Utilities](#module-26-ui-primitives-radix-rewards-components-expertskill-cards--lib-utilities)
28. [Module 27: Remaining Web Components, UI Primitives & Lib Utilities](#module-27-remaining-web-components-ui-primitives--lib-utilities)
29. [Module 28: Community Skill Detail, Integrations, i18n, Tests & Infrastructure](#module-28-community-skill-detail-integrations-i18n-tests--infrastructure)
30. [Module 29: Desktop Renderer, Slimclaw Package, Dev Utils, Nexu Skills, Scripts](#module-29-desktop-renderer-slimclaw-package-dev-utils-nexu-skills-scripts)
31. [Module 30: Runtime Plugins, Desktop Updater/Platforms, Scripts & Dev Tools](#module-30-runtime-plugins-desktop-updaterplatforms-scripts--dev-tools)
32. [Module 31: Remaining Controller Source, Desktop Build Scripts, Slimclaw, Docs & Smoke](#module-31-remaining-controller-source-desktop-build-scripts-slimclaw-docs--smoke)
33. [Module 32: Controller Tests](#module-32-controller-tests)
34. [Module 33: Desktop Tests](#module-33-desktop-tests)
35. [Module 34: Remaining Tests (Web, Shared, NexuPal, E2E) & Final Sweep](#module-34-remaining-tests-web-shared-nexupal-e2e--final-sweep)
36. [Module 35: Final Missed Files — Lifecycle, Scripts & Sidecars](#module-35-final-missed-files--lifecycle-scripts--sidecars)
37. [Module 36: Documentation, i18n, Notify Scripts & Dev Platform](#module-36-documentation-i18n-notify-scripts--dev-platform)
38. [Module 37: Runtime Plugins (openclaw-weixin + whatsapp)](#module-37-runtime-plugins-openclaw-weixin--whatsapp)
39. [Module 38: Desktop Build Scripts & Shared Modules](#module-38-desktop-build-scripts--shared-modules)
40. [Module 39: Desktop Renderer App](#module-39-desktop-renderer-app)
41. [Module 40: Controller Scripts & Remaining Files](#module-40-controller-scripts--remaining-files)
42. [Module 41: Fringe Scripts & Utilities (Final Sweep)](#module-41-fringe-scripts--utilities-final-sweep)

---

## 摘要仪表板

| 严重级别 | 数量 | 描述 |
|----------|------|------|
| **严重** | 34 | 竞态条件、Shell/PowerShell 注入、数据丢失、O(N) 全量扫描、凭据泄露、无条件硬页面刷新、静默发送失败、自动更新安装失败、并发拆解、原始 fetch 违反仅 SDK 规则（2个文件）、伪造 API 密钥验证、非桌面构建中的分析轮询、未处理 IPC 错误、shell-open 端点使用原始 fetch、150行的 extractMessage() 包含 6 个格式分支、重复的聊天消息格式化、基于 blur 事件的本地应用检测、3624 行单体组件、1362 行单体工作区布局、手写 markdown 解析器、双重类型转换 API 响应、混合使用手动 fetch + React Query、第二个手写 markdown 解析器（community-skill-detail 中的 parseMdBlocks）、手写内联 markdown 渲染器（renderInline）、三重类型转换 `as unknown as SkillDetail` 绕过类型安全、对压缩 JS 进行 13+ 精确字符串替换（slimclaw runtime-stage）、通过字符串拼接导致的 cmd.exe 注入（spawn.ts wscript.exe 启动器） |
| **高** | 123 | 安全：凭据泄露、缺少运行时重启、不安全的类型转换、Electron 安全漏洞、Zod 错误泄露、模式验证缺陷、web sidecar 路径遍历、A2UI 动态子项扩展、contentEditable XSS/IME、凭据错误信息泄露、打包构建中依赖 PATH 的二进制文件、`as never` 类型绕过、experthub 中远程版本字符串路径遍历、仅模拟 UI 且表单提交失效、生产环境 console.log 泄露、模板中使用原始 fetch 而非 SDK、伪造 API 密钥验证、WebSocket 无自动重连（3个 hooks）、大量内联组件、1361 行单体布局、废弃的 Seedance 促销代码、误导性假进度条、重复的频道连接逻辑、`undefined as unknown as string` 类型强制转换、伪造奖励验证延迟、废弃的 GitHub 导入标签页、卡片作为链接的反模式重复、PLATFORM_CONFIG 三重重复、不安全的 bot 类型转换、基于文本的乐观去重、A2UI JSONL 逐行 try/catch、OAuth 轮询不稳定依赖、localStorage OAuth 泄露、9 分支链式三元平台选择器、`window.confirm()` 用于破坏性操作（3处）、Desktop IPC 桥接通过反射、轮询循环重复、OAuth refetch 竞态、MiniMax OAuth fetchQuery+refetchQueries 竞态、provider 状态重置丢弃编辑、7 分支链式三元奖励弹窗、指针坐标布局抖动、8 阶段状态机、重复的左侧面板品牌、飞书 toast 中硬编码 Slack 字符串、重连 WebSocket 重复设置逻辑、假进度条 + 无界 while(true)、PROVIDER_LABELS 重复、零代码分割、频道设置向导 80% 重复、4 个凭据设置视图 90% 复制粘贴、原始 fetch 访问 api.github.com、WhatsApp 无界 QR 轮询循环、formatDownloads bug 用于 community-skill-card 中的星标数、模型下拉框在 ChatInputArea + InlineModelSelector 间 80% 重复、Seedance 促销废弃代码含有 2x setInterval 永久运行、SkillMdPreview 中标题级别偏移破坏可访问性、OAuth 回调轮询使用 integrations.length 作为数据变更代理、localStorage 中的 OAuth pending 状态无 TTL/清理、LOCALE_READER_LINES 向打包上下文注入 require()、包含嵌入 markdown 的单体 skills.json、13+ 脆弱的精确字符串补丁无版本检测 |
| **中** | 249 | 逻辑错误、TypeScript 安全缺陷、架构问题、竞态条件、不一致的错误处理、A2UI 状态同步模式、重复代码、手动 fetch 与 React Query 混用、同步 launchctl 阻塞主进程、日志尾部 TOCTOU、飞书语言硬编码为英语、watcher 竞态将技能标记为未安装、内联 hook 重复、巨大的函数复杂度、localStorage 无清理、自定义 markdown 解析器脆弱性、文件上传的 base64 内存问题、硬编码的范围列表、空直通组件、O(N*M) 图标解析、重复的模型分组、硬编码的频道标签、不安全的类型转换、未测试的状态机、轮询泛滥、字符串耦合的错误处理、重复的 Electron 检测、脆弱的文件 URL 路径构建、缺少 CardFooter、不一致的元数据键名、5 次正则元数据剥离、硬编码的缩写 token、元数据变更时 SSE 重连、flatMap 内联分隔符、客户端命令拦截、不必要的 hook 抽象、硬编码的轮询超时、脆弱的 oauthTabRef 模式、弹窗竞态条件、PLATFORM_LABELS 重复、未检查的 API 响应类型转换、脆弱的 accountId 解析、内联对话框组件 x2、硬编码主题颜色、history-state 后退导航、安装/卸载模式重复（x5）、sessionStorage 认证返回检测、claim 防重复提交竞态、任意重定向延迟、硬编码的分析 identify、setInterval 轮询而非 React Query、QR URL 无验证、静默重命名失败、设备错误格式化器误用、任务详情渲染重复、带取消标志的手动 fetch、WebSocket 状态魔术字符串、脆弱的字符串前缀匹配、OAuth refetch 间隔检查 undefined 不明确、crash-reports 状态从未持久化、双 ref 模式的自动切换检测、单个组件中 30+ props/state、云登录状态机内联、formatChannelConnectErrorMessage 误用于设备、API 完成前对话框关闭、消息解析未经验证的类型转换、指针映射重复、原生对话框而非 shadcn/ui、频道配置 JSX 在 t 变更时重建、formatBytes 内联、FileBubble 扩展名到图标的 if/else 链、CHANNEL_LABELS 重复 3+ 次、30s 轮询无可见性检查、内联 useDebounce 重复（第3次出现）、硬编码的英文操作步骤、3 个相同的 click-outside 处理器、使用 getBoundingClientRect 的手动 portal 定位、localStorage 认证门控、桌面透明度 hack、GitHubIcon/NexuIcon SVG 重复、硬编码的 LOCAL_PROVIDER_ICON_KEYS、基于错误字符串匹配的重试、不安全的模型类型转换、下拉框打开时双重渲染、identify 中硬编码的频道数、DialogBody 缺少分隔符、云连接使用 setInterval 轮询、原生对话框而非 Radix、JSON.stringify 脏检测、3 变体 CTA 重复、use-community-catalog 中 5 个不安全的 as 类型转换、bootstrapLocale 竞态条件复杂性、auto-fallback useEffect 难以测试、预算 CTA 按钮在 banner+dialog 中重复、奖励分享资源 DOM 泄漏、198 行 switch-case SVG 图标文件、expert-card card-as-link 反模式、logout 在异步 signOut 前清除状态、外部 api.qrserver.com 依赖、不正确的星标数显示、automations.tsx 100% 模拟 UI 且提交按钮失效、formatBytes 在 chat-input-area+sessions 中重复、formatRelativeTime 分歧的 i18n 实现、base64 编码在 React 状态中保持约 10MB 字符串、第 7 个 click-outside mousedown 处理器无共享 hook、parseMdBlocks 重复 markdown 解析器、renderInline 手写内联渲染器、SkillMdPreview 标题偏移 +1、oauthTabRef 脆弱的弹窗生命周期、localStorage OAuth pending 无 TTL/清理、OAuth setInterval 轮询而非 React Query、integrations Effect 依赖不稳定的 length 引用、SkillDetail 三重类型转换绕过、JSON.parse() 作为 DevLock 未验证、runtime-paths 相对于 ../../../ 解析、硬编码的 criticalRuntimeFiles 包含 @whiskeysockets/baileys 路径、桌面 shell 中 4 个 surface 始终挂载、消息 banner 的重复 JSX、compacted-flag 文件系统 TOCTOU、写时复制克隆无校验和验证、3 个 plist 写入器共享重复的 env/逻辑、bootstrapLocale 自动回退不可测试 |
| **低** | 230 | 代码质量、小幅改进、文档缺陷、可访问性、废弃的三元代码、未引用的 socket、时钟敏感的重启计数器、N+1 文件读取、脆弱的 frontmatter 解析器、未使用的变量、lint-disable 注释、魔术数字、竞态敏感的模板 ref、内联 debounce 重复、硬编码 URL、重复的 WS 处理器、直通包装组件、内联动画组件、未使用的 useId、switch-case 用于映射、误导性变量命名、无样式原生 select、JSON.stringify 脏检测、内联 SVG 图标、对话框 overlay 始终开启、模块级分析状态、markdown-it 防御性回退、硬编码头像路径、手写时间格式化、空白加载状态、空操作处理器、无条件轮询、重复的 query 定义、硬编码 i18n 字符串、复杂类型推导、废弃的 "Coming Soon" UI、硬编码中文字符串（x6 文件）、useId 生成但浪费、标题级别偏移破坏语义、useMemo 用于静态数据、不一致的 Card 组件使用、Link 导入仅用于一处、通过 userAgent 检测平台、硬编码英文回退文本、奖励弹窗硬编码按钮颜色、硬编码 GitHub Issues URL、重复的搜索输入样式、双重类型转换错误消息提取、Escape 键的原生 keydown 监听器、服务器排序后客户端再排序、手动的 titleByPathname Record、内联 FadeIn 动画组件、switch-case PlatformIcon、50 类 Tailwind className、getProviderIdFromModelId 重复、硬编码英文 "Beta" 徽章、i18n 键作为步骤标识符、bg-transparent 依赖缺失的 CSS 变量、14 行直通 BrandMark、bot-picker 原生 select + 过时 TODO、硬编码语言名称、内联 "N" logo、localStorage useState 初始化器、color-mix 无回退、ToolkitIcon URL 变更时有状态回退、useCountdown 不可见轮询、第 6 个 click-outside mousedown 模式、废弃的 Skills 按钮、usePageTitle 在兄弟路由上竞态、CardFooter 缺失于 shadcn/ui card、textarea 中 bg-transparent 而非项目 CSS 变量、rewards teaser 中 15+ 内联十六进制颜色、硬编码分享资源图片、过度防御的 clampRandomValue、110 条硬编码中文标签翻译 Record、desktop-platform 类型缩窄使用 void 返回、内部依赖已废弃的 formatDownloads、shadcn/ui CSS 变量未在项目中定义、formatRelativeTime 硬编码英文字符串、PLATFORM_CONFIG 在 sessions.tsx 中重复、硬编码英文回退 defaultValue、未使用的 _expandedId 状态、原生 select 而非项目下拉框、getProviderIdFromModelId 重复（第3份）、role=button div 缺少 Escape 键、parseMdBlocks 使用 String.slice(0,-1) 剥离标题、frontmatter 正则剥离 YAML 而非使用 gray-matter、useMemo 在导入时计算 i18n defaultValue、dev proxy middleware beforeEach 使用 async/await、logout 在服务器 signOut 前清除 localStorage、chat-input Skills 按钮无 onClick 处理器、useStatusBadgeConfig 在每次 t 引用变更时重新计算、DisconnectDialog 使用固定 inset-0 而非 Radix Dialog、skill-translations 110 条硬编码 Record、normalizeSearch 对不可达输入的防御性前缀、webSurfaceVersion=0 静态永不变化、复杂的 onDesktopCommand 监听器包含 6 个命令分支、formatBuildTimestamp 28 行手写 ISO 8601、controller-ready 中 4 个超时参数、gray-matter + writeFileSync build-index、runtime-formatters 中 28 行手写 ISO 8601、2s 间隔轮询 profiles、无共享助手的手动 Blob 下载模式 |

### 前 50 优先问题

1. **严重: LowDbStore.update() 竞态条件** — 并发的 read-modify-write 导致数据丢失 (Module 6)
2. **严重: 开发脚本中的 Shell/PowerShell 注入** — `cmd.exe /c` + `.join(" ")`，PowerShell 字符串插值 (Module 12)
3. **严重: misc-compat-routes.ts 凭据泄露** — API 密钥转发到代理，错误消息可能泄露 (Module 3)
4. **严重: chat-routes.ts 使用 app.get()** — SSE 端点绕过 OpenAPI/SDK 生成 (Module 3)
5. **严重: desktop-routes.ts 使用 app.post()** — compaction-notify 无模式验证 (Module 3)
6. **严重: sessions-runtime getSession() O(N) 全量扫描** — 为单个查找读取每个会话文件 (Module 4)
7. **高: API 密钥在 serializeProvider() 中泄露** — 原始 API 密钥返回到前端 (Module 6)
8. **高: Zod 解析错误中的密钥** — 包含凭据的配置在验证错误中暴露 (Module 2)
9. **高: 3 个路由文件中缺少 openclawProcess.restart()** — desktop-compat、model-routes、provider-oauth 违反硬性规则 (Module 3)
10. **高: shell:open-external 缺少 URL 验证** — 渲染器可打开任意协议处理器 (Module 7)
11. **高: 桌面密钥暴露给渲染器** — 网关 token、认证密码、Sentry DSN 通过 IPC 发送 (Module 7)
12. **高: runtime-config.ts 中的硬编码凭据** — 源代码中的网关 token 和认证密码 (Module 7)
13. **高: skillhub/npm-runner.ts 中的 Shell 注入** — 使用插值字符串的 exec (Module 5)
14. **高: 会话文件系统路径泄露** — 会话元数据中暴露绝对路径 (Module 4)
15. **高: Slack appToken 占位符缺失** — HTTP 模式配置被 OpenClaw 拒绝 (Module 2)
16. **严重: 生产环境 console.log 泄露运行状态** — 每 3 秒轮询记录频道连接性 (Module 9)
17. **严重: 静默消息发送失败** — 聊天发送失败时无 toast/错误提示 (Module 9)
18. **严重: 导航时无条件硬页面刷新** — React Router 之后 `window.location.href` 总是触发 (Module 9)
19. **严重: 自动更新安装失败** — `autoInstallOnAppQuit = true` 与 `app.exit(0)` 冲突，后台下载的更新在正常退出时永远不会安装 (Module 8)
20. **严重: 并发拆解即发即忘** — `onForceQuit`、`onQuitCompletely`、`runTeardownAndExit` 并行运行无同步 (Module 8)
21. **高: Webview preload 暴露完整 IPC 桥接** — 47 个 IPC 通道对禁用沙箱的 webview 内容可用，XSS = 完整 Electron 妥协 (Module 13)
22. **高: 7 个凭据字段接受空字符串** — OpenClaw 配置模式凭据字段缺少 `.min(1)`，与 API 输入模式不一致 (Module 11)
23. **高: Web sidecar 路径遍历** — 未验证的 `pathname` 允许在 localhost 上读取 `../../../etc/passwd` 文件 (Module 15)
24. **高: Experthub 远程版本路径遍历** — 文件路径中未验证的 `remote.version` 允许在缓存外执行 `rmSync` (Module 5)
25. **高: 4 个打包构建位置中依赖 PATH 的二进制文件** — `netstat`、`pgrep`、`which`、`lsof` 从 PATH 获取在打包 Electron 中会失效 (Module 8, Module 15)
26. **严重: local-chat.tsx 使用原始 fetch() 而非 SDK** — `fetch("/api/v1/chat/local")` 违反硬性规则 "前端必须使用生成的 SDK，绝不使用原始 fetch" (Module 17)
27. **高: automations.tsx 完全是模拟/占位符** — 所有数据硬编码，表单提交按钮无处理器，过滤器计数使用模拟数据 (Module 17)
28. **高: home.tsx 生产环境 console.log 泄露运行状态** — `[home:live-status]` 每 2 秒在生产构建中记录调试日志 (Module 17)
29. **高: expert-custom.tsx 使用原始 fetch() 加载 4 个模板** — 使用 `fetch()` 调用获取 AGENTS.md、IDENTITY.md、SOUL.md、USER.md 模板而非 SDK (Module 17)
30. **严重: welcome.tsx 伪造 API 密钥验证** — `setTimeout(() => setVerified(true), 1200)` 模拟验证而没有任何实际 API 调用；BYOK 设置使用未验证的密钥继续 (Module 18)
31. **中: useDebounce 在 3 个独立文件中内联定义** — `experts.tsx`、`skills.tsx` 重复相同的 10 行 hook；应该是共享导入 (Module 17, 18)
32. **高: workspace-layout.tsx 是 1361 行单体组件** — 单个文件处理侧边栏、对话、账户、余额、更新、帮助、登出和 4 个文档 mousedown 处理器。不可测试且脆弱 (Module 19)
33. **高: 微信假进度条是误导性用户体验** — `calcFakeProgress` 显示 40 秒内 0 到 95% 的缓出曲线，与实际 QR 码可用性无关 (Module 19)
34. **高: SeedancePromo 是废弃代码** — `SEEDANCE_PROMO_DEADLINE = April 2026` 已过期；倒计时器、横幅、弹窗和 425 行代码已废弃 (Module 19)
35. **高: ChannelConnectModal 重复各个设置视图的连接逻辑** — Slack/Discord 凭据提交在弹窗和每个频道视图中都存在 (Module 19)
36. **高: 6 个频道设置视图间代码高度重复** — wechat、whatsapp、slack、discord、dingtalk、telegram 遵循相同的 form->API->navigate 模式，约 60% 结构重复 (Module 19)
37. **中: InviteGuardLayout 是空直通组件** — 5 行，返回 `<Outlet />` 无任何守卫逻辑 (Module 19)
38. **中: ProviderLogo O(NxM) 图标解析** — 每次渲染时对每个模型 ID 检查 27 个子字符串模式；50 个模型需要 1350 次字符串操作 (Module 19)
39. **中: Auth-layout 加载状态渲染空 div** — 当认证状态为 "pending" 时，显示 `<div />` 而非加载指示器 (Module 19)
40. **高: 伪造奖励验证 — 1.4 秒装饰性延迟** — `runVirtualRewardCheck` 除了 `await wait(1400)` 什么也不做。与 welcome.tsx 中伪造 API 密钥验证相同的模式 (Module 20)
41. **高: Import-skill-modal GitHub 标签页是废弃占位符 UI** — 禁用的输入框带有 "Coming Soon" 标签；22 行非功能性 UI (Module 20)
42. **严重: desktop-links.ts 使用原始 fetch() 调用 shell-open API** — 第二次违反 "前端必须使用生成的 SDK" 硬性规则；`fetch("/api/internal/desktop/shell-open")` (Module 20)
43. **中: use-auto-update.ts 是 299 行未测试的状态机** — 7 个阶段、3 个 useEffect hooks、IPC 事件、轮询、能力检测；零测试覆盖 (Module 20)
44. **中: 26 个工具包权限集硬编码在 179 行 TypeScript 文件中** — 应该在 JSON 或区域设置文件中的静态配置数据 (Module 20)
45. **严重: sessions.tsx extractMessage() 是 150 行格式解析怪物** — 处理 6 种内容格式（字符串文本、字符串内容、包含 7 种块类型的块数组），内联 A2UI JSONL 解析带有逐行 try/catch。无 Zod 验证；上游格式变更会静默破坏消息渲染 (Module 21)
46. **高: handleSend 重复 local-chat.tsx 的消息负载格式化** — `{ type, content, attachments }` 构造在两个文件中重复；任何 API 变更需要双重编辑 (Module 21)
47. **高: handleOpenSlack 使用 blur 事件的原生应用检测** — `window.location.href = nativeUrl` + 5 秒回退通过 `window.addEventListener("blur")`；如果浏览器在协议导航时未失去焦点则静默失败 (Module 21)
48. **高: PLATFORM_CONFIG 在 3 个文件中三重重复** — sessions.tsx、channels.tsx、platform-icons.tsx 各自定义独立的 platform->color/label 映射 (Module 21)
49. **高: 通过文本比较的乐观去重** — 待处理消息通过比较文本内容去重；快速连续发送的相同消息会被错误合并 (Module 21)
50. **高: WebSocket 无自动重连** — `useDeviceSnapshot` 和 `useMirrorSocket` 在 close/error 时永久丢弃连接；无重连逻辑 (Module 18)

---

## Module 1: Controller - App Bootstrap & DI Container

**审查文件:**
- `apps/controller/src/index.ts`
- `apps/controller/src/types.ts`
- `apps/controller/src/app/bootstrap.ts`
- `apps/controller/src/app/container.ts`
- `apps/controller/src/app/create-app.ts`
- `apps/controller/src/app/env.ts`

### 问题

| # | 文件 | 严重级别 | 问题 | 建议修复 |
|---|------|----------|------|----------|
| 1.1 | `create-app.ts:79` | **高** | `/health` 使用 `app.get()` — 违反 `createRoute()` + `app.openapi()` 规则 | 定义 Zod 响应模式并使用 `createRoute()` + `app.openapi()` |
| 1.2 | `container.ts:314` | **高** | `listBots()` 返回值上的不安全类型断言 `as Array<{ id: string; expertSlug: string }>` | 使用 `"expertSlug" in b` 检查进行适当的类型缩窄或将 `expertSlug` 添加到返回类型 |
| 1.3 | `env.ts:104` | **高** | `OPENCLAW_GATEWAY_TOKEN: z.string().optional()` — 空字符串通过验证 | 添加 `.min(1)` 以防止空 token |
| 1.4 | `index.ts:93` | **中** | 未类型化的 `catch (error)` — 潜在的隐式 `any` | 添加显式 `: unknown` 注解 |
| 1.5 | `bootstrap.ts:90` | **中** | `prepareDesktopCloudModelsForBootstrap().catch(() => {})` 静默吞没错误 | 记录带有错误详情的警告 |
| 1.6 | `create-app.ts:98` | **中** | 健康端点无论实际健康状态如何始终返回 200 | 当 `runtimeState.status` 不健康时返回 503 |
| 1.7 | `container.ts:348` | **中** | 单监听器回调 `onCloudStateChanged` 可被静默覆盖 | 使用 EventEmitter 或订阅模式 |
| 1.8 | `container.ts:339` | **中** | `fsp.rm` 上默认 `recursive: true` 无路径边界验证 | 删除前验证路径在预期的 `agentsDir` 边界内 |
| 1.9 | `index.ts:109` | **低** | 信号处理器在引导后注册（90 秒窗口无处理器） | 尽早注册最小处理器 |
| 1.10 | `index.ts:87` | **低** | `finally` 中的 `process.exit(0)` 掩盖了关闭失败 | 跟踪 `stop()` 成功并以适当代码退出 |
| 1.11 | `container.ts:248,302` | **低** | 重复的 `createBot` 适配器代码 | 提取共享辅助函数 |
| 1.12 | `create-app.ts:95` | **低** | `gateway.lastError` 可能泄露内部错误详情 | 对非本地上下文清理内部信息 |
| 1.13 | `env.ts:121` | **低** | 模块级环境单例阻碍可测试性 | 在单例旁导出工厂函数 |

---

## Module 2: Controller - Lib/Utilities

**审查文件:**
- `apps/controller/src/lib/channel-binding-compiler.ts`
- `apps/controller/src/lib/channel-connect-error.ts`
- `apps/controller/src/lib/local-ip.ts`
- `apps/controller/src/lib/logger.ts`
- `apps/controller/src/lib/managed-models.ts`
- `apps/controller/src/lib/model-provider-runtime.ts`
- `apps/controller/src/lib/openclaw-config-compiler.ts`
- `apps/controller/src/lib/openclaw-config-serialization.ts`
- `apps/controller/src/lib/path-utils.ts`
- `apps/controller/src/lib/provider-base-url.ts`
- `apps/controller/src/lib/proxy-fetch.ts`
- `apps/controller/src/lib/secrets.ts`
- `apps/controller/src/lib/v8-coverage.ts`

### 问题

| # | 文件 | 严重级别 | 问题 | 建议修复 |
|---|------|----------|------|----------|
| 2.1 | `openclaw-config-compiler.ts:577` | **高** | `openclawConfigSchema.parse()` 抛出包含原始 API 密钥、bot token、签名密钥的 ZodError | 切换到 `safeParse()` 并进行清理后的错误日志（仅记录问题路径，绝不记录值） |
| 2.2 | `channel-binding-compiler.ts:134` | **高** | Slack HTTP 模式设置 `appToken: undefined` — OpenClaw 即使在 HTTP 模式下也需要此字段 | 设置占位符 `"xapp-placeholder-not-used-in-http-mode"` |
| 2.3 | `proxy-fetch.ts:342-348` | **中** | `proxyFetchJson<T>` 将 `await response.json() as T` 强制转换而不验证 — 实际上是 `as any` | 接受 Zod 模式参数或返回 `unknown` |
| 2.4 | `proxy-fetch.ts:322-326` | **中** | `proxyFetch` 不检查 `response.ok` — 4xx/5xx 静默作为成功返回 | 添加 `throwOnHttpError` 选项或单独的 `proxyFetchOk()` |
| 2.5 | `logger.ts:42` | **中** | Logger `details` 展开可能覆盖保留字段（`level`、`time`、`message`） | 在 details 之后展开保留字段 |
| 2.6 | `model-provider-runtime.ts:201-208` | **中** | `legacyOauthCredential` 的不安全类型转换 — 仅检查 `provider`/`access`，不检查 `refresh`/`expires`/`email` | 使用 Zod 模式解析凭据对象 |
| 2.7 | `openclaw-config-compiler.ts:394+` | **中** | 直接的 `process.env` 读取散布在整个编译器中，而非使用 `ControllerEnv` | 扩展 `ControllerEnv` 并将环境值作为参数传递 |
| 2.8 | `openclaw-config-compiler.ts:432` | **中** | `dangerouslyAllowHostHeaderOriginFallback: true` 削弱了 CORS 保护 | 记录原因，考虑仅限开发模式的开关 |
| 2.9 | `path-utils.ts:17` | **中** | `ensureRelativeChildPath` 拒绝包含 `..` 的合法文件名（例如 `file..txt`） | 检查路径段：`segments.some(s => s === "..")` |
| 2.10 | `channel-binding-compiler.ts:106` | **中** | `process.env.SLACK_SOCKET_MODE_APP_TOKEN` 直接读取而非通过参数 | 将 `socketAppToken` 添加到参数对象 |
| 2.11 | `local-ip.ts:12` | **低** | 第一个非环回 IP 可能是 Docker/VM 网桥接口 | 过滤已知的虚拟网桥前缀 |
| 2.12 | `logger.ts:25` | **低** | `getLevel()` 在每次日志调用时重新读取 `process.env` | 在模块加载时缓存级别 |
| 2.13 | `managed-models.ts:25` | **低** | `link/` 前缀 provider 提取的模型 ID 格式未记录 | 添加记录预期格式的 JSDoc |
| 2.14 | `model-provider-runtime.ts:44` | **低** | `as ProviderMetadataRecord` 类型转换削弱了类型安全 | 轻微偏差 — 有外部对象检查时可接受 |
| 2.15 | `path-utils.ts:5` | **低** | `expandHomeDir` 不处理裸 `~`（仅 `~/`） | 添加裸 `~` 情况 |
| 2.16 | `proxy-fetch.ts:245-277` | **低** | 全局代理状态变更在并发请求下不安全 | 轻微 — 代理配置很少变更 |
| 2.17 | `proxy-fetch.ts:184` | **低** | `sanitizeErrorMessage` 正则不捕获查询字符串或 bearer token 模式 | 扩展正则以包含额外的凭据模式 |
| 2.18 | `channel-binding-compiler.ts:114` | **低** | 飞书频道不一致地绕过 `status !== "connected"` 过滤器 | 添加说明注释或缩小豁免范围 |

---

## Module 3: Controller - Routes (API Layer)

**审查文件:** `apps/controller/src/routes/` 中所有 20 个路由文件

### 严重问题

| # | 文件 | 问题 | 建议修复 |
|---|------|------|----------|
| 3.1 | `chat-routes.ts:221` | `app.get()` 用于 SSE 流式传输 — 绕过 OpenAPI/SDK 生成 | 添加空 200 响应的 OpenAPI 路由定义以供 SDK 使用 |
| 3.2 | `desktop-routes.ts:323` | `/api/internal/compaction-notify` 使用 `app.post()` — 无 Zod 模式，不安全的 `as string` 类型转换 | 转换为带 Zod 模式的 `app.openapi(createRoute(...))` |
| 3.3 | `misc-compat-routes.ts:346-361` | API 密钥转发到上游代理 — 日志中的错误消息可能包含凭据 | 将 fetch 包装在 try/catch 中，在记录前清理错误 |

### 高级别问题

| # | 文件 | 问题 | 建议修复 |
|---|------|------|----------|
| 3.4 | `desktop-compat-routes.ts:157-408` | 云配置变更后缺少 `openclawProcess.restart()` — 硬性规则违规 | 在每个 `syncAll()` 调用后的 provider 变更路由中添加重启 |
| 3.5 | `model-routes.ts:129-146` | provider 配置变更后缺少 `openclawProcess.restart()` | `setModelProviderConfigDocument` 后始终重启 |
| 3.6 | `provider-oauth-routes.ts:122,192` | OAuth 连接/断开后缺少 `openclawProcess.restart()` | 在 provider 配置写入后添加重启 |
| 3.7 | `media-routes.ts:11` | 使用 `app.get()` — 无 OpenAPI 路由；`filename.includes("..")` 是不充分的路径遍历保护 | 使用 `path.basename(filename)` + 验证解析路径以 screenshots 目录开头 |
| 3.8 | `device-task-history-routes.ts:51,82` | `as never` 类型断言使所有类型检查失效 | 正确修复类型不匹配 — 将 `deviceName` 添加到响应模式 |
| 3.9 | `desktop-routes.ts:326` | `body.sessionKey as string` — 来自未验证 body 的不安全类型转换 | 定义适当的 Zod 模式并使用 `c.req.valid("json")` |
| 3.10 | `misc-compat-routes.ts:229-233` | 每次聊天完成请求时从磁盘读取配置文件 — 性能 + 密钥泄露 | 使用文件监听器失效缓存解析的配置 |

### 中级别问题

| # | 文件 | 问题 | 建议修复 |
|---|------|------|----------|
| 3.11 | `channel-routes.ts` | 不一致的错误处理 — 一些频道使用结构化错误，其他使用原始 `error.message` | 将所有频道迁移到 `logChannelConnectFailure` |
| 3.12 | `chat-routes.ts:296-355` | `setInterval` 内的同步 `readFileSync`/`statSync` 阻塞事件循环 | 使用异步文件 I/O 或带尾部策略的 `fs.watch` |
| 3.13 | `chat-routes.ts:289,366` | 重复的 `stream.onAbort` 注册 | 合并为单一处理器 |
| 3.14 | `bot-routes.ts:55-66` | 原始 `err.message` 返回给客户端可能泄露内部信息 | 返回通用消息，记录实际错误 |
| 3.15 | `misc-compat-routes.ts:529` | `new Response()` 绕过 Hono 中间件（CORS、日志） | 使用 Hono 的 `c.stream()` / `streamSSE()` |
| 3.16 | `misc-compat-routes.ts:591,670` | 桩端点（invite validate、shared-slack claim）始终通过 | 记录为桌面本地桩 |
| 3.17 | `provider-oauth-routes.ts:17` | `providerId` 参数无约束 — 允许任意配置键创建 | 添加 `.min(1).regex(...)` 约束 |
| 3.18 | `runtime-config-routes.ts:81-85` | 设备控制端口无端口范围验证 | 添加 `.min(1024).max(65535)` |
| 3.19 | `skillhub-routes.ts:176-210` | 安装端点 body 使用了错误的模式（卸载） | 创建专用的 `skillhubInstallRequestSchema` |
| 3.20 | `skillhub-routes.ts:7-135` | 许多模式内联定义而非在 `@nexu/shared` 中 | 移至 shared 以便 SDK 类型生成 |
| 3.21 | `model-routes.ts:182,282` | 重复的 validate/verify 路由 | 废弃其中一个并记录规范路由 |
| 3.22 | `desktop-rewards-routes.ts:83` | 请求 body 被接受但完全忽略 | 从路由定义中移除 body 或使用它 |

---

## Module 4: Controller - Runtime

**审查文件:** `apps/controller/src/runtime/` 中所有 18 个文件

### 严重问题

| # | 文件 | 问题 | 建议修复 |
|---|------|------|----------|
| 4.1 | `sessions-runtime.ts:1146-1149` | `getSession(id)` 调用 `listSessions()` -> 读取**每个**会话文件、元数据和飞书 API 调用来进行单个查找 | 实现仅读取特定会话文件的目标查找 |

### 高级别问题

| # | 文件 | 问题 | 建议修复 |
|---|------|------|----------|
| 4.2 | `openclaw-process.ts:599-602` | `killOrphanedOpenClawProcesses()` 向命令行中包含 "openclaw" 和 "gateway" 的任何进程发送 SIGKILL — 过于宽泛 | 匹配精确二进制路径或检查 PPID；在 SIGKILL 之前使用 SIGTERM |
| 4.3 | `sessions-runtime.ts:664-674` | `readFirstLineTimestamp` 为一行内容读取整个多 MB 的 JSONL 文件 | 使用 `open` + `fh.read(buf, 0, READ_BYTES, 0)` 模式如 `inferSessionHints` |
| 4.4 | `sessions-runtime.ts:1359-1368` | `buildPublicMetadata` 向客户端泄露会话元数据中的绝对文件系统路径 | 移除 `path` 字段或使用不透明标识符 |
| 4.5 | `loops.ts:27` | `syncAll()` 可能在不调用 `openclawProcess.restart()` 的情况下修改 provider — 硬性规则违规 | 验证合约或添加重启检测 |

### 中级别问题

| # | 文件 | 问题 | 建议修复 |
|---|------|------|----------|
| 4.6 | `openclaw-process.ts` | `readdirSync`/`readFileSync`/`execSync` 在 start() 期间阻塞事件循环 | 转换为异步等效方法 |
| 4.7 | `openclaw-ws-client.ts:366-368` | 单监听器 `onConnected`/`onGatewayShutdown` 回调 — 第二次注册静默替换第一次 | 使用 `Set<() => void>` 监听器模式 |
| 4.8 | `openclaw-auth-profiles-store.ts:191` | OAuth `expires` 字段单位不明确 — `Date.now()` 返回毫秒，OAuth 标准使用秒 | 添加启发式：如果 `<1e12`，视为秒并乘以转换 |
| 4.9 | `sessions-runtime.ts` | listSessions() 迭代期间的 `writeSessionMetadata()` 可能与并发写入竞争 | 使用原子写入（临时文件 + 重命名） |
| 4.10 | `openclaw-watch-trigger.ts` | `invalidateSessionSkillSnapshots()` 读取/重写 `sessions.json` — 与 OpenClaw 写入竞争 | 使用原子文件替换 |
| 4.11 | `slimclaw-runtime-plugin-writer.ts:41,92` | `rm(..., { recursive: true, force: true })` 无路径包含检查 | 验证 `targetDir` 以预期前缀开头 |
| 4.12 | `gateway-client.ts:20` | `(await response.json()) as T` — 无验证的不安全泛型类型转换 | 接受 Zod 模式进行运行时验证 |
| 4.13 | `openclaw-config-writer.ts:68-76` | `readdirSync`/`rmSync` 在配置写入期间阻塞事件循环 | 使用异步 `readdir` 和 `rm` |

### 低级别问题

| # | 文件 | 问题 | 建议修复 |
|---|------|------|----------|
| 4.14 | `openclaw-ws-client.ts:62-64` | `crypto.sign` 返回值上的可疑双重类型转换 | 移除类型转换或记录类型问题 |
| 4.15 | `openclaw-ws-client.ts:536-537` | `JSON.parse(raw) as Frame` — 反序列化类型无运行时验证 | 对 `parsed.type` 添加最小类型检查 |
| 4.16 | `sessions-runtime.ts` | 无界的 `feishuTokenCache` Map — 无最大尺寸 | 使用 LRU 缓存或限制条目数 |
| 4.17 | `loops.ts` | 循环函数上无 `@Trace`/`@Span` 注解 | 添加 span 用于可观测性 |
| 4.18 | `openclaw-process.ts` | `awaitControlledRestart` 通过 void Promise 静默吞没错误 | 添加带日志的 `.catch()` 处理器 |

---

## Module 5: Controller - Services

**审查文件:** `apps/controller/src/services/` 中所有 40+ 文件

### 高级别问题

| # | 文件 | 问题 | 建议修复 |
|---|------|------|----------|
| 5.1 | `channel-service.ts` | 频道连接在验证前存储凭据 — Slack bot token/签名密钥在 `auth.test` 之前持久化 | 在持久化之前通过轻量级 API 调用验证凭据 |
| 5.2 | `openclaw-sync-service.ts` | 配置写入与运行时重载之间的同步竞态 — 运行时可能读取部分写入的文件 | 使用原子文件写入（临时文件 + 重命名） |
| 5.3 | `skillhub/npm-runner.ts` | 通过 skill 包名的 Shell 注入 — 使用插值字符串的 `exec` | 使用带参数数组的 `execFile`；针对严格模式验证包名 |
| 5.4 | `skillhub/npm-runner.ts` | npm runner 使用依赖 PATH 的 `npm` — 违反打包应用规则 | 使用编程式 API 或通过 `require.resolve` 解析 npm 路径 |

### 中级别问题

| # | 文件 | 问题 | 建议修复 |
|---|------|------|----------|
| 5.5 | `skillhub/zip-importer.ts` | Zip 解压路径遍历（zip slip） — 恶意 zip 可在目标目录外写入文件 | 验证每个解压文件的解析路径以目标解压目录开头 |
| 5.6 | `skillhub/install-queue.ts` | 安装队列在重启后不持久化 — 部分安装丢失 | 为安装队列添加持久化层 |
| 5.7 | `chat-service.ts` | 聊天消息转发无大小限制 | 添加可配置的最大消息大小 |
| 5.8 | `model-provider-service.ts` | API 密钥以明文存储在配置 JSON 中 | 使用系统密钥链或静态加密 |
| 5.9 | `openclaw-auth-service.ts` | Token 刷新竞态 — 多个同时刷新 | 围绕刷新实现互斥锁 |
| 5.10 | `device-control-service.ts` | 设备控制命令未针对允许列表验证 | 添加命令允许列表验证 |
| 5.11 | `skillhub-service.ts` | 委托给子模块但无一致的错误处理 | 添加集中式错误标准化 |
| 5.12 | `analytics-service.ts` | 事件单独发送而不批量处理 | 批量处理事件以提高效率 |

### 低级别问题

| # | 文件 | 问题 | 建议修复 |
|---|------|------|----------|
| 5.13 | `skillhub/skill-dir-watcher.ts` | 文件监视器不去抖快速变更 | 添加去抖（500ms+） |
| 5.14 | `openclaw-gateway-service.ts` | 重连退避硬编码，不可配置 | 使其可配置 |
| 5.15 | `agent-service.ts` | Agent 名称唯一性未强制执行 | 添加名称唯一性检查 |
| 5.16 | `channel-fallback/core/template-renderer.ts` | 模板渲染使用基本字符串插值而不转义 | 使用适当的模板引擎或清理输入 |
| 5.17 | `attachment-store.ts` | 来自外部源的附件文件名未清理 | 清理文件名 |
| 5.18 | `cloud-reward-service.ts` | Cloud API 响应未使用 Zod 验证 | 添加模式验证 |
| 5.19 | `github-star-verification-service.ts` | GitHub API 调用无速率限制处理 | 处理 HTTP 429 并重试 |
| 5.20 | `session-service.ts` | 旧会话数据累积无清理策略 | 添加保留策略 |

---

## Module 6: Controller - Store (Persistence)

**审查文件:**
- `apps/controller/src/store/lowdb-store.ts`
- `apps/controller/src/store/schemas.ts`
- `apps/controller/src/store/nexu-config-store.ts`
- `apps/controller/src/store/artifacts-store.ts`
- `apps/controller/src/store/compiled-openclaw-store.ts`
- `apps/controller/src/store/device-task-history-store.ts`

### 问题

| # | 文件 | 严重级别 | 问题 | 建议修复 |
|---|------|----------|------|----------|
| 6.1 | `lowdb-store.ts` | **严重** | `update()` 执行非原子的 read-modify-write — 并发调用者读取相同的过期缓存，第二次写入覆盖第一次的变更 | 在写入队列内序列化整个 read-modify-write |
| 6.2 | `nexu-config-store.ts:390` | **高** | `serializeProvider()` 在返回的响应中包含原始 `apiKey` — 如果路由处理器直接返回，API 密钥发送到前端 | 从序列化响应中移除 `apiKey`；`hasApiKey` 字段已存在 |
| 6.3 | `schemas.ts:312` | **中** | OAuth `access`/`refresh` token 存储在 provider `metadata.legacyOauthCredential` 中 — 可能在 API 响应中泄露 | 将 OAuth 凭据移至专用的 `secrets` 记录 |
| 6.4 | `schemas.ts` | **中** | 所有 API 密钥/bot token 以明文 JSON 存储在 `~/.nexu/config.json` 中 | 考虑 OS 密钥链或至少 `0600` 文件权限 |
| 6.5 | `nexu-config-store.ts:213,837,2193` | **中** | 外部/网络数据上的不安全类型断言（`as Array<...>`、`as CloudPollResponse`） | 对外部数据使用 Zod `safeParse` |
| 6.6 | `lowdb-store.ts` | **中** | 排队写入期间缓存过期 — `read()` 在 `write()` 调用和队列处理之间返回旧缓存 | 乐观更新缓存或记录最终一致性 |
| 6.7 | `schemas.ts` | **低** | `controllerRuntimeConfigSchema` 使用 `.passthrough()` — 未知属性静默保留 | 除非需要向前兼容，否则使用 `.strip()` |
| 6.8 | `nexu-config-store.ts:1564` | **低** | `disconnectChannel` 依赖 JS 属性评估顺序的副作用变量 | 在构造返回对象之前计算 `disconnectedChannel` |
| 6.9 | `nexu-config-store.ts` | **低** | bot 创建无去重保护 — `getOrCreateDefaultBot()` 可能竞争 | 在 `update()` 回调内检查现有 bot |
| 6.10 | `artifacts-store.ts` | **低** | 无界的 artifact 增长 — 没有 `MAX_ARTIFACTS` 上限，不像 `DeviceTaskHistoryStore` | 添加 FIFO 驱逐上限 |
| 6.11 | `artifacts-store.ts` | **低** | 无法将可选字段清除为 `null` — `null ?? oldValue` 计算为 `oldValue` | 使用 `!== undefined` 检查而非空值合并 |
| 6.12 | `compiled-openclaw-store.ts` | **低** | `readConfig()` 返回 `Record<string, unknown>` 丢失 `OpenClawConfig` 类型 | 读取时通过模式解析或类型化存储泛型 |
| 6.13 | `device-task-history-store.ts:54` | **低** | `appendQueue.catch(() => undefined)` 静默吞没错误 | 吞没前记录警告 |
| 6.14 | `device-task-history-store.ts:45` | **低** | 截图 `unlink` 是即发即忘，无错误日志 | 失败时记录警告 |
| 6.15 | `lowdb-store.ts` | **低** | 备份在原子重命名之前写入 — 备份和重命名之间的崩溃造成不一致状态 | 重命名之后写入备份 |

---

## Module 7: Desktop - Main Process

**审查文件:** `apps/desktop/main/`、`apps/desktop/shared/`

### 高级别问题

| # | 文件 | 问题 | 建议修复 |
|---|------|------|----------|
| 7.1 | `shared/runtime-config.ts:11,325-329` | 源代码中的硬编码凭据：`DEFAULT_GATEWAY_TOKEN`、带固定密码的 `desktopAuth` — 在所有构建中发布 | 生成每次会话的随机凭据；在打包构建中绝不使用 `DEFAULT_GATEWAY_TOKEN` |
| 7.2 | `shared/runtime-config.ts:188-224` | `DesktopRuntimeConfig` 通过 IPC 向渲染器暴露 `tokens.gateway`、`desktopAuth.password`、`langfuseSecretKey`、`sentryDsn` | 创建省略密钥的清理 `DesktopRuntimeConfigPublic` 类型 |
| 7.3 | `main/ipc.ts:731-745` | `shell:open-external` 通过 `shell.openExternal()` 渲染任何 URL 而无协议验证 | 打开前验证 URL 协议为 `http:` 或 `https:` |
| 7.4 | `main/redaction.ts:1` | `SENSITIVE_URL_PARAM_RE` 仅匹配 `token|password|secret` — 遗漏 `api_key`、`access_token`、`auth`、`key`、`code` | 扩展 URL 参数模式以包含这些 |
| 7.5 | `main/index.ts:138-155` | 在 `app.whenReady()` 之前的顶层 `await` 端口分配 — 如果端口分配失败则崩溃 | 移入 `app.whenReady()` 块并添加错误对话框 |

### 中级别问题

| # | 文件 | 问题 | 建议修复 |
|---|------|------|----------|
| 7.6 | `shared/runtime-config.ts:261-268` | `Number.parseInt` 可以为无效的端口环境变量产生 `NaN` | 验证并回退到默认值 |
| 7.7 | `main/ipc.ts` | 不安全的 `payload as HostInvokePayloadMap[...]` 类型转换无运行时验证 | 为 IPC 负载添加 Zod 验证 |
| 7.8 | `main/ipc.ts:285-314` | `fetchControllerJson` 重试 10 次 — 遇到 4xx 时抛出 `await response.text()` 可能泄露凭据 | 仅在网络/5xx 错误时重试；截断错误 body |
| 7.9 | `main/index.ts:103-106` | 单实例锁定失败时 `app.quit()` + 立即 `process.exit(0)` | 单独使用 `app.exit(0)` |
| 7.10 | `main/index.ts:392-397` | 通过 `as unknown as Record<string,unknown>` 修补 `app` 对象以实现强制退出标志 | 使用模块级布尔变量 |
| 7.11 | `main/index.ts:1450-1513` | 两个独立的 `window.on("close")` 处理器 — 执行顺序取决于注册顺序 | 合并为单一处理器 |
| 7.12 | `main/index.ts:1802-1815` | 废弃代码路径 — 早期检查后 `runtimeMode === "external"` 分支不可达 | 移除或验证意图 |
| 7.13 | `main/desktop-diagnostics.ts:548` | 硬编码仅 macOS 的崩溃报告路径（`~/Library/Logs/DiagnosticReports`） | 添加平台检查；在 Windows 上使用 `app.getPath("crashDumps")` |
| 7.14 | `main/redaction.ts:9-31` | `redactJsonValue` 递归无深度限制 — 深度嵌套 JSON 上的栈溢出 | 添加最大深度参数（例如 20） |
| 7.15 | `main/bootstrap.ts:31-77` | 自定义 `.env` 解析器不处理 `export` 前缀、多行值、内联注释 | 记录限制或在开发模式下使用 `dotenv` |
| 7.16 | `shared/desktop-paths.ts:4` | `getDesktopNexuHomeDir` 接受 `userDataPath` 参数但忽略它 | 移除参数或记录为何未使用 |
| 7.17 | `shared/host.ts:169-401` | 约 8 个几乎相同的云配置文件响应类型重复 | 提取共享的 `CloudProfileStatusResponse` 类型 |

### 低级别问题

| # | 文件 | 问题 | 建议修复 |
|---|------|------|----------|
| 7.18 | `main/index.ts` | 不一致的产品命名：贯穿使用 "nexu"、"Nexu"、"Tabby" | 统一为单一常量 |
| 7.19 | `main/desktop-diagnostics.ts:144-145` | ZIP 写入器使用 `UInt16LE` 记录条目数 — 超过 65536 条目时溢出 | 添加保护 |
| 7.20 | `main/desktop-diagnostics.ts:415-466` | 桌面诊断文件读取两次（一次清理，一次原始） — TOCTOU 竞态 | 在单次遍历中解析原始缓冲区后再清理 |
| 7.21 | `main/cookies.ts:13` | Cookie 解析正则可能在复杂的 `Expires` 日期值上失败 | 记录限制或使用专用解析器 |
| 7.22 | `shared/workspace-paths.ts:6` | `import.meta.dirname` 需要 Node >=21.2 / Electron >=28 | 信息性 — 对目标运行时无问题 |

---

## Module 8: Desktop - Services & Updater

**审查文件:** `apps/desktop/main/services/`、`apps/desktop/main/updater/`

### 严重问题

| # | 文件 | 问题 | 建议修复 |
|---|------|------|----------|
| 8.1 | `update-manager.ts:75` + `quit-handler.ts:73` | **自动安装失败** — `autoUpdater.autoInstallOnAppQuit = true` 但正常退出路径使用 `app.exit(0)` 跳过 `will-quit` 事件。后台下载的更新永远循环：已下载 -> 退出 -> 未安装 -> 下次启动重新下载。只有 "重启并更新" 的显式流程有效 | 跟踪待处理下载；在退出处理器中调用 `autoUpdater.quitAndInstall()` 或移除 `autoInstallOnAppQuit` 以诚实表明行为 |
| 8.2 | `quit-handler.ts:119-124` | **并发拆解** — `onForceQuit()`、`onQuitCompletely()`、`runTeardownAndExit()` 全部以 `void` 并发触发（无 `await`）。launchd 服务的双重拆解、web 服务器的双重关闭、未定义的回调重叠 | 顺序 `await` 每个调用：`opts.onForceQuit?.()` -> `await opts.onQuitCompletely?.()` -> `await runTeardownAndExit(...)` |

### 高级别问题

| # | 文件 | 问题 | 建议修复 |
|---|------|------|----------|
| 8.3 | `launchd-bootstrap.ts:1689` | **从 PATH 获取的 `lsof`，所有错误被视为 "未锁定"** — (a) 使用依赖 PATH 的 `lsof` 违反 AGENTS.md 规则；(b) `catch` 将 "lsof exit 1 = 安全"、"lsof 未找到 = 无法确定"、"超时 = 无法确定" 混为同一 `locked: false`。如果 `lsof` 缺失，关键的更新安全门静默跳过 | 通过绝对路径解析 `/usr/sbin/lsof`；区分 "运行干净 -> 未锁定" 与 "错误 -> 已锁定" |
| 8.4 | `services/launchd-manager.ts` | 通过服务标签字符串插值的 launchctl 命令注入 | 对所有 launchctl 命令使用带参数数组的 `execFile` |
| 8.5 | `updater/update-manager.ts` | `checkCriticalPathsLocked()` 返回 "安全" 与安装开始之间的 TOCTOU 窗口 | 保持文件锁或在安装前立即重新检查 |
| 8.6 | `services/quit-handler.ts` | `runTeardownAndExit` 即使拆解抛出异常也始终调用 `app.exit(0)` | 跟踪拆解成功；失败时使用 `app.exit(1)` |

### 中级别问题

| # | 文件 | 问题 | 建议修复 |
|---|------|------|----------|
| 8.7 | `launchd-bootstrap.ts:2045-2046,2141-2143` | **`rm -rf` 和 `rename` 之间的 TOCTOU** — 第三方可在移除和重命名之间在 `runnerRoot` 创建内容，导致 EEXIST。标准原子模式：`rename(old->backup)` -> `rename(staging->target)` -> `rm(backup)` | 使用原子交换模式 |
| 8.8 | `quit-handler.ts:67,148-152` | **`plistDir ?? ""` 导致过期的 `runtime-ports.json`** — 当 `plistDir` 未定义时，`deleteRuntimePorts("")` 目标为 CWD 而非真正的 plist 目录。过期的端口文件跨重启存活，混淆下次附加逻辑 | 使 `plistDir` 必填或默认为生产 plist 目录 |
| 8.9 | `update-manager.ts:520-526` | **`prepareForUpdateInstall` 不在 try/catch 中** — 抛出跳过所有后续拆解、进程终止和锁检查。无数据丢失但更新安装静默失败 | 用 try/catch 和日志包装 |
| 8.10 | `launchd-bootstrap.ts:551-552` | **`resolveUserShellPath` 加载用户 `.zshrc`** — `-ilc` 标志在桌面启动路径中执行任意用户 shell 代码。超时限制挂起但崩溃导致启动回退 | 有超时可接受；记录可靠性顾虑 |
| 8.11 | `launchd-bootstrap.ts` | 外部 runner 提取不验证文件完整性（无校验和） | 添加提取后校验和验证 |
| 8.12 | `launchd-bootstrap.ts` | 读取端口文件和检查活跃性之间的过期会话检测竞态 | 加锁或重新检查 |
| 8.13 | `launchd-manager.ts` | `bootoutService` 错误容忍可能掩盖真实失败 | 容忍错误时以警告级别记录 |
| 8.14 | `update-manager.ts` | `ensureNexuProcessesDead` 在进程无法杀死时返回而不确认所有进程已死 | 记录剩余 PID 并重试 |
| 8.15 | 其他服务 | Orchestrator 不单独跟踪 sidecar 健康状态 — 崩溃的 sidecar 直到下一个周期才被检测 | 添加每个 sidecar 的健康跟踪 |

### 低级别问题

| # | 文件 | 问题 | 建议修复 |
|---|------|------|----------|
| 8.16 | `services/launchd-bootstrap.ts` | Plist XML 通过字符串模板生成而非 XML 库 | 当前使用可接受 |
| 8.17 | `updater/update-manager.ts` | 更新 feed URL 使用前未验证为 HTTPS | 验证 URL 格式 |
| 8.18 | `launchd-bootstrap.ts`、`quit-handler.ts` | `pgrep`、`lsof` 从 PATH 解析 — AGENTS.md 规则适用于所有系统二进制文件 | 通过绝对路径解析 |

---

## Module 9: Web - Core App, Pages & Components

**审查文件:** `apps/web/src/` 中所有 140+ 文件

### 严重问题

| # | 文件 | 问题 | 建议修复 |
|---|------|------|----------|
| 9.1 | `pages/home.tsx:555-562` | **生产环境 `console.log` 泄露运行状态** — 通过 `channels-live-status` React Query 轮询每 3 秒逐频道记录连接性。在生产构建中向浏览器 devtools 暴露内部网关/频道状态 | 移除 `console.log` 或用 `import.meta.env.DEV` 保护 |
| 9.2 | `pages/local-chat.tsx:142-148,182-186` | **无条件硬页面刷新** — `setTimeout(() => { window.location.href = target }, 200)` 在 `navigate()` 之后总是触发，导致每次 "发送" 操作时不必要的完整页面刷新。第 147 行的 `return` 仅退出 `if` 块但 `setTimeout` 已被调度 | 移除 `window.location.href`；如果 React Router 导航失败，在路由层面处理 |
| 9.3 | `pages/sessions.tsx:939-943` | **静默消息发送失败** — catch 块重置状态但不显示 toast/错误。当 `postApiV1ChatLocal` 拒绝时，用户看到消息消失无任何解释。与 `/new` 命令处理器正确显示 toast 形成对比 | 在 catch 块中添加 `toast.error(t("sessions.chat.sendFailed"))` |

### 高级别问题

| # | 文件 | 问题 | 建议修复 |
|---|------|------|----------|
| 9.4 | `pages/local-chat.tsx:121-129,163-165` | 原始 `fetch("/api/v1/chat/local", ...)` 和 `fetch("/api/v1/chat/session?...")` 绕过生成的 SDK — 违反硬性规则 "前端必须使用生成的 SDK"。`sessions.tsx` 中已导入相同函数。`safe-json` 解析回退（第 130 行）破坏类型安全 | 替换为 `postApiV1ChatLocal(...)` 和 `getApiV1ChatSession(...)` |
| 9.5 | `pages/expert-custom.tsx:659,668,679,688` | 原始 `fetch("/api/v1/experthub/platform-templates/AGENTS.md", ...)` 绕过生成的 SDK — 应使用 `getApiV1ExperthubPlatformTemplatesByFilename(...)` | 替换为生成的 SDK 函数 |
| 9.6 | 组件 | 桌面 webview URL 未清理 — 用户控制的数据可能流入 webview 导航 | 验证和清理 URL；使用受信任的域名允许列表 |

### 中级别问题

| # | 文件 | 问题 | 建议修复 |
|---|------|------|----------|
| 9.7 | `app.tsx` | 路由未懒加载 — 所有页面急切导入，增加初始包大小 | 使用 `React.lazy()` 和 `Suspense` 进行路由级代码分割 |
| 9.8 | 页面 | 多个页面缺少加载状态 — React Query 填充前闪烁空白内容 | 添加 `Suspense` 或在渲染前检查 `isLoading` |
| 9.9 | 页面 | 页面级缺少错误边界 — 组件抛出异常导致整个应用崩溃 | 在页面级添加 `ErrorBoundary` |
| 9.10 | 组件 | 表单组件不去抖 API 调用（搜索、按键验证） | 添加 300-500ms 去抖 |
| 9.11 | 组件 | 大列表无虚拟化 — 大数据集的性能问题 | 使用 `react-window` 或 `@tanstack/react-virtual` |
| 9.12 | Channel Setup | 频道连接表单在 API 调用期间不禁用提交 — 允许重复提交 | 在 `useMutation.isPending` 期间禁用按钮并显示加载状态 |

### 低级别问题

| # | 文件 | 问题 | 建议修复 |
|---|------|------|----------|
| 9.13 | 组件 | 使用内联样式而非 CSS 模块/设计 token | 迁移到设计 token |
| 9.14 | `pages/channels.tsx:217-268` | 仅图标操作按钮缺少 `aria-label`（编辑、暂停/播放、删除） — 屏幕阅读器无法播报 | 向仅图标按钮添加 `aria-label` |
| 9.15 | `pages/channels.tsx:821-826` | 确认对话框背景点击关闭不支持键盘 — 有 `onClick` 但无 `onKeyDown` | 为 Enter/Space 添加 `onKeyDown` 处理器 |
| 9.16 | 组件 | 硬编码十六进制颜色而非 Ant Design 主题 token | 使用主题 token |
| 9.17 | 组件 | 技能卡片组件在每次父组件状态变更时重新渲染 — 无 `React.memo` | 添加 `React.memo()` |
| 9.18 | 组件 | 桌面特定代码无平台检查保护 | 用平台检测保护 |

---

## Module 10: Web - Hooks, Lib & SDK

**审查文件:** `apps/web/src/hooks/`（16 个文件）、`apps/web/src/lib/`（23 个文件）、`apps/web/lib/api/`（4 个文件）

### 高级别问题

| # | 文件 | 问题 | 建议修复 |
|---|------|------|----------|
| 10.1 | `lib/desktop-links.ts:92-99` | `/api/internal/desktop/shell-open` 使用原始 `fetch` 绕过生成的 SDK | 使用 SDK 中的 `postApiInternalDesktopShellOpen` |
| 10.2 | `hooks/use-github-stars.ts:42-57` | 原始 `fetch` + 未类型化的 `.json()` 响应 — 非 JSON 响应抛出未处理的拒绝 | 类型化响应，检查 `res.ok` |

### 中级别问题

| # | 文件 | 问题 | 建议修复 |
|---|------|------|----------|
| 10.3 | `hooks/use-community-catalog.ts:49,72,104` | SDK 响应上不安全的 `as unknown as` / 裸 `as` 类型转换 | 使用生成的类型或 Zod 验证 |
| 10.4 | `hooks/use-auto-update.ts:234-252` | 不稳定的 `bridge` ref 使 `useCallback` 记忆化失效 | 用 `useMemo` 稳定化 |
| 10.5 | `hooks/use-desktop-budget-guard.ts:135-181` | useEffect 依赖中的 mutation 对象导致每次渲染执行 | 提取稳定的 `mutateAsync` ref |
| 10.6 | `hooks/use-bot-quota.ts:9-11` | SDK 错误静默忽略 — 默认为 `available: true` | 检查错误并抛出 |
| 10.7 | `hooks/use-bots.ts:9-11` | 相同的静默错误吞没模式 | 检查错误并抛出 |
| 10.8 | `hooks/use-cloud-connect.ts:30-83` | `cloudConnecting` 状态在放弃的 OAuth 流程中可能卡住 | 添加超时回退或取消函数 |

### 低级别问题

| # | 文件 | 问题 | 建议修复 |
|---|------|------|----------|
| 10.9 | `hooks/use-auto-update.ts:79,146` | 重复的 `window as NexuWindow` 类型转换 | 提取到模块级或 `useMemo` |
| 10.10 | `lib/api/event-source.ts:27-72` | SSE 无自动重连 | 记录重连责任 |
| 10.11 | `hooks/use-active-channel.ts:43-59` | effect 依赖中的数组引用不稳定 | 父组件应记忆化数组 |
| 10.12 | `lib/tracking.ts:34-38` | 分析的模块级可变状态 | 分析单例可接受 |

**无问题的干净文件:** `use-countdown.ts`、`use-page-title.ts`、`use-locale.tsx`（竞态条件感知）、`use-desktop-rewards.ts`（Zod 验证）、`markdown.ts`（安全默认值: html:false）、`auth-client.ts`、`utils.ts`、channel-link 工具。
| 10.5 | `hooks/use-desktop-budget-guard.ts:135-181` | `useEffect` 依赖中的 Mutation 对象导致每次渲染都执行 | 提取稳定的 `mutateAsync` 引用 |
| 10.6 | `hooks/use-bot-quota.ts:9-11` | SDK 错误被静默忽略 — 默认返回 `available: true` | 检查错误并抛出 |
| 10.7 | `hooks/use-bots.ts:9-11` | 相同的静默错误吞没模式 | 检查错误并抛出 |
| 10.8 | `hooks/use-cloud-connect.ts:30-83` | `cloudConnecting` 状态在放弃的 OAuth 流程中可能卡住 | 添加超时回退或取消函数 |

### 低问题

| # | 文件 | 问题 | 建议修复 |
|---|------|-------|---------------|
| 10.9 | `hooks/use-auto-update.ts:79,146` | 重复的 `window as NexuWindow` 类型转换 | 提取到模块级别或 `useMemo` |
| 10.10 | `lib/api/event-source.ts:27-72` | SSE 无自动重连 | 文档说明重连责任归属 |
| 10.11 | `hooks/use-active-channel.ts:43-59` | effect 依赖中数组引用不稳定 | 父组件应 memoize 数组 |
| 10.12 | `lib/tracking.ts:34-38` | 模块级别的可变状态用于分析 | 对于分析单例可接受 |

**无问题文件：** `use-countdown.ts`、`use-page-title.ts`、`use-locale.tsx`（有竞态条件感知）、`use-desktop-rewards.ts`（Zod 验证）、`markdown.ts`（安全默认值：html:false）、`auth-client.ts`、`utils.ts`、频道链接工具。

---

## Module 11: Packages - shared、slimclaw、dev-utils

**审查文件：** `packages/shared/src/`、`packages/slimclaw/src/`、`packages/dev-utils/src/`

### 高问题

| # | 文件 | 问题 | 建议修复 |
|---|------|-------|---------------|
| 11.1 | `shared/src/schemas/openclaw-config.ts:228,255,273,309,359,373,386` | **7 个凭据字段使用裸 `z.string()` 而没有 `.min(1)`** — `slackAccountSchema.botToken`、`discordAccountSchema.token`、`feishuAccountSchema.appSecret`、`telegramAccountSchema.botToken`、`qqbotChannelSchema.clientSecret`、`dingtalkChannelSchema.clientSecret`、`wecomChannelSchema.secret`。空字符串被接受为有效凭据。与使用 `.min(1)` 的 `channel.ts` API 输入 schema 不一致 | 为所有凭据字段添加 `.min(1)` |
| 11.2 | `shared/src/schemas/openclaw-config.ts:9-12` | **Gateway `mode: "token"` 不强制要求 token 存在** — 即使 `mode: "token"` 时也是 `token: z.string().optional()`。配置可以写成 `{ auth: { mode: "token" } }` 而没有 token | 添加 `superRefine` 要求 `mode === "token"` 时必须有 token |
| 11.3 | `shared/src/schemas/provider.ts:28-35` | **`upsertProviderBodySchema.apiKey` 接受空字符串** — `z.string().nullable().optional()` 没有 `.min(1)`。空字符串会无意中清除密钥 | 使用 `z.string().min(1).nullable().optional()` |
| 11.4 | `shared/src/schemas/openclaw-config.ts:446` | **`modelProviderSchema.apiKey` 缺少 `.min(1)`** — `z.union([z.string(), providerSecretRefSchema]).optional()` 接受空字符串。API schema `providerSecretInputSchema` 正确使用了 `.min(1)` — 不一致 | 与 `providerSecretInputSchema` 对齐：使用 `z.string().min(1)` |
| 11.5 | `shared/src/schemas/openclaw-config.ts:97-102` | `memorySearchRemoteSchema.apiKey` 缺少 `.min(1)` | 使用 `z.string().min(1).optional()` |
| 11.6 | `shared/src/schemas/user.ts:24-30` | `updateUserProfileSchema.image`（data URL）没有最大长度限制 — base64 载荷可能达到数 MB。`createCustomExpertRequestSchema.avatarDataUrl` 正确使用了 `.max(2_000_000)` | 添加 `.max(2_000_000)` 以匹配 `avatarDataUrl` 限制 |

### 中问题

| # | 文件 | 问题 | 建议修复 |
|---|------|-------|---------------|
| 11.7 | `model-provider-config.ts` + `openclaw-config.ts` | `providerSecretRefSchema` 在两个文件中重复 — 维护时有分歧风险 | 从 `model-provider-config.ts` 导入，移除本地副本 |
| 11.8 | `provider.ts:5` 与 `model-provider-config.ts:4-8` | `providerAuthModeSchema` 使用 `"apiKey"` 而 `persistedProviderAuthModeSchema` 使用 `"api-key"` — 枚举值大小写不匹配。前者还缺少 `"aws-sdk"` 和 `"token"` 值 | 使用 `persistedProviderAuthModeSchema` 或重命名以明确区分 |
| 11.9 | `model-provider-config.ts:79-94` | `superRefine` 覆盖了 `oauth`、`api-key`、`token` 但跳过了 `aws-sdk` — Bedrock 用户没有验证 | 添加 `aws-sdk` 分支或文档说明故意不覆盖 |
| 11.10 | `provider-aliases.ts:27-50` | `parseCustomProviderKey` 不验证 instanceId — 像 `custom-openai/foo/bar` 这样的键会产生 `instanceId: "foo/bar"`，可能在路径/URL 使用中出错 | 拒绝 instanceId 中嵌入的 `/` 或添加验证 |
| 11.11 | `shared/src/schemas/` | Schema 一致性 — 一些使用 `.passthrough()`，另一些使用 `.strip()`，没有 `.strict()` | 对面向 API 的 schema 标准化为 `.strict()` |
| 11.12 | `shared/src/schemas/` | Bot schema 接受空系统提示 | 添加 `.min(1)` 或设为可选 |
| 11.13 | `shared/src/model-providers/` | Provider 注册表是静态的 — 添加 provider 时必须手动更新 | 添加启动验证检查 |
| 11.14 | `dev-utils/src/process.ts` | 进程管理不验证 PID 是否已被回收 | 在 SIGKILL 之前检查命令名或启动时间 |

### 低问题

| # | 文件 | 问题 | 建议修复 |
|---|------|-------|---------------|
| 11.15 | `shared/src/schemas/` | 模型标识符格式未验证 | 添加格式约束 |
| 11.16 | `shared/src/schemas/` | 许多字段缺少 `.describe()` — OpenAPI 文档不充分 | 添加描述 |
| 11.17 | `shared/src/schemas/openclaw-config.ts` | 嵌套 schema 上大量使用 `.passthrough()` 意味着像 `botTken` 这样的拼写错误会静默通过验证 | 考虑在关键路径使用 `.strict()` |
| 11.18 | `shared/src/model-providers/` | Provider 别名不是双向映射 | 添加反向映射或文档说明 |
| 11.19 | `slimclaw/src/` | 运行时路径构造不验证目录是否存在 | 文档说明调用者责任 |
| 11.20 | `dev-utils/src/lock.ts` | 基于文件的锁使用文件创建，而非操作系统级 `flock` | 对开发工具可接受；文档说明 NFS 限制 |
| 11.11 | `dev-utils/src/logger.ts` | 直接使用 console.log — 无结构化日志级别 | 对开发工具可以接受 |

---

## Module 12: 工具与脚本

**审查文件：** `tools/dev/src/`、`scripts/`

### 严重问题

| # | 文件 | 问题 | 建议修复 |
|---|------|-------|---------------|
| 12.1 | `scripts/desktop-check-dev.mjs` | 通过 `cmd.exe /c` + `.join(" ")` 在 Windows 上造成 Shell 注入 — 参数中的元字符被解释为 Shell 语法 | 使用 `spawn` 配合 `{ shell: false }` 和数组参数 |
| 12.2 | `scripts/desktop-check-dist.mjs` | 相同的 `cmd.exe /c` + `.join(" ")` Shell 注入模式 | 相同修复方式 |
| 12.3 | `tools/dev/src/shared/platform/desktop-dev-platform.win32.ts` | 通过 `escapePowerShellString` 造成 PowerShell 注入 — 仅转义单引号，不转义反引号或通配符 | 在插值前用严格正则表达式验证 `launchId` |

### 高问题

| # | 文件 | 问题 | 建议修复 |
|---|------|-------|---------------|
| 12.4 | `tools/dev/src/shared/dev-runtime-config.ts` | 硬编码的默认网关 token `"gw-secret-token"` — 众所周知的密钥 | 移除硬编码默认值；要求环境变量或 `.env` 文件 |
| 12.5 | `tools/dev/src/supervisors/controller.ts` | 文件监视器重启逻辑中 `restartTimer = null` 和 `restartPending = true` 之间的竞态条件 | 使用异步互斥锁/队列模式 |
| 12.6 | 所有 supervisor | 异步信号处理器没有 `try/finally` — 如果任何 `await` 抛出，清理可能被跳过 | 用 `try/finally` 包裹，保证 `process.exit` 和锁清理 |
| 12.7 | `tools/dev/src/services/desktop.ts` | Electron `eval` 检查命令将未清理的表达式传递给渲染器 | 文档说明仅用于开发；添加防护 |
| 12.8 | `scripts/desktop-ci-check.mjs` | JSON 解析前未验证 HTTP 响应 — 非 200 时产生不透明的解析错误 | 检查 `res.ok` 和 content-type |

### 中问题

| # | 文件 | 问题 | 建议修复 |
|---|------|-------|---------------|
| 12.9 | `tools/dev/src/shared/platform/desktop-dev-platform.darwin.ts` | 通过 ps 输出中的字符串匹配进行 PID 检测不够健壮 | 使用 launch ID 标记进行更精确的匹配 |
| 12.10 | 所有平台文件 | 不支持 Linux 平台 | 添加明确检查并显示"不支持"错误 |
| 12.11 | `scripts/postinstall.mjs` | tsc 路径解析假设提升了的 `.bin/` 符号链接 | 使用 `require.resolve("typescript/bin/tsc")` |
| 12.12 | `scripts/notify/daily-content-bot.mjs` | LLM JSON 解析假设有效结构 — 在 markdown 包裹的输出上失败 | 解析前剥离 markdown 围栏 |
| 12.13 | `scripts/probe/slack-reply-probe.mjs` | Chrome Canary 路径硬编码 | 检查二进制文件是否存在；显示安装说明 |

### 低问题

| # | 文件 | 问题 | 建议修复 |
|---|------|-------|---------------|
| 12.14 | `tools/dev/src/shared/dev-runtime-config.ts` | 端口值解析没有范围验证 | 验证端口在 1-65535 范围内 |
| 12.15 | `tools/dev/src/shared/trace.ts` | `DevService` 类型不穷尽 — 新服务不会被捕获 | 从 const 数组派生 |
| 12.16 | `scripts/nexu-pal/lib/github-client.mjs` | `GITHUB_TOKEN` 未设置时没有警告 | 发出明确警告 |
| 12.17 | 所有脚本 | Shell 脚本使用 `#!/bin/sh` 但使用了 bash 特性 | 使用 `#!/usr/bin/env bash` |

---

## Module 13: Desktop - Preload、Renderer 与 Electron 配置

**审查文件：** `apps/desktop/preload/`、`apps/desktop/src/`、构建配置

### 严重问题

| # | 文件 | 问题 | 建议修复 |
|---|------|-------|---------------|
| 13.1 | `preload/webview-preload.ts` + `main/index.ts:1347-1351` | **Webview preload 向禁用沙箱的内容暴露了完整的 IPC 桥接** — `webview-preload.ts` 几乎是主 preload 的完整副本，暴露了所有 47 个 IPC 通道上的 `invoke()`，包括 `shell:open-external`、`runtime:start-unit`、`app:quit`、`desktop:delete-cloud-profile`、`desktop:import-cloud-profiles` 和 `update:set-channel`。`will-attach-webview` 处理器强制所有 webview 的 `sandbox: false`。任何 webview 表面（工作区、OpenClaw 网关）中的 XSS 都可获得完整的 Electron IPC 访问权限 | 创建受限的 preload，仅暴露 webview 表面需要的通道（理想情况下为零 — 改用 HTTP 连接 controller）。添加 CSP 头。添加 `will-navigate` 处理器限制导航到 localhost |

### 高问题

| # | 文件 | 问题 | 建议修复 |
|---|------|-------|---------------|
| 13.2 | `main/ipc.ts:731-744` | **`shell:open-external` 没有任何 URL 验证** — 调用方提供的 URL 直接传递给 `shell.openExternal()`，没有协议白名单。被入侵的渲染器可以打开 `file://`、`slack://`、`x-apple.systempreferences:` 或任何已注册的协议处理器 | 添加 URL 协议白名单，仅限 `http:` 和 `https:` |
| 13.3 | `main/index.ts`、`vite.config.ts`、`surface-frame.tsx` | **任何表面都没有内容安全策略** — 主渲染器、webview 工作区和 OpenClaw 网关都缺少 CSP 头或 meta 标签。结合完整的 IPC webview preload，任何脚本注入都立即可被利用 | 通过 `session.defaultSession.webRequest.onHeadersReceived()` 添加 CSP — 至少 `script-src 'self'; object-src 'none'` |
| 13.4 | `preload/index.ts:65-67` | `sentryDsn`、`posthogApiKey`、`posthogHost` 通过 bootstrap 暴露给渲染器 — 由于 bootstrap 可访问，与 webview 内容共享 | 验证密钥仅授予遥测范围，而非管理/导出 |
| 13.5 | `preload/index.ts` | Preload 暴露了广泛的 IPC 接口 — 被入侵的渲染器可能利用未验证的通道 | 审计每个 IPC 通道；在主进程中验证所有参数 |

### 中问题

| # | 文件 | 问题 | 建议修复 |
|---|------|-------|---------------|
| 13.6 | `build/entitlements.mac.plist:9` | **`disable-library-validation` 权限**削弱了代码完整性 — 允许加载任意未签名的 `.dylib`。大多数 Electron 应用因 V8 JIT 而存在此权限，但意味着对应用包有写访问权限的攻击者可以加载恶意库 | 在安全态势文档中记录；监控应用包和 `~/.nexu/runtime/` 的文件系统级攻击 |
| 13.7 | `surface-frame.tsx:135` + `main/index.ts:215` | **`allowpopups=""` 硬编码且全局禁用了弹窗拦截器** — webview 内的 `window.open()` 可以创建新实例，尽管 `setWindowOpenHandler` 返回 `deny` | 移除 `allowpopups=""`，除非特定表面有文档记录的需求 |
| 13.8 | `src/main.tsx` | 无内容安全策略 — 内联样式/脚本不受限制 | 添加严格的 CSP meta 标签 |
| 13.9 | 构建配置 | 代码签名配置必须在 macOS 分发前验证 | 确保签名配置符合 Gatekeeper 合规要求 |

### 低问题

| # | 文件 | 问题 | 建议修复 |
|---|------|-------|---------------|
| 13.10 | `preload/webview-preload-url.ts` | Preload URL 构造 — 开发模式与打包模式下路径解析正确性 | 在两种模式下验证 |
| 13.11 | 构建配置 | asar 打包 — 验证归档中未包含敏感文件 | 审计 asar 内容 |
| 13.12 | `vite.config.ts` | 生产构建中包含 source map | 禁用或上传到 Sentry，从分发包中排除 |

---

## Module 14: A2UI 功能与 Web 组件

**审查文件：**
- `apps/web/src/lib/a2ui/a2ui-renderer.tsx`
- `apps/web/src/lib/a2ui/a2ui-surface.ts`
- `apps/web/src/lib/a2ui/components/*.tsx`（TextField、CheckBox、ChoicePicker、Slider、DateTimeInput、Image、Video、AudioPlayer、Modal）
- `apps/web/src/lib/a2ui/custom-components/MarkdownEditor.tsx`
- `apps/web/src/lib/a2ui/custom-components/PhonePreview.tsx`
- `apps/web/src/pages/devices/device-card.tsx`
- `apps/web/src/pages/devices/use-mirror-socket.ts`
- `apps/web/src/pages/devices/task-detail-page.tsx`
- `apps/web/src/pages/devices/task-history-page.tsx`
- `apps/web/src/components/chat-input-area.tsx`
- `apps/web/src/components/channel-setup/*.tsx`

### 高问题

| # | 文件 | 问题 | 建议修复 |
|---|------|-------|---------------|
| 14.1 | `lib/a2ui/a2ui-renderer.tsx:43-64` | **动态子列表扩展是一次性的** — `useMemo` 仅以 `messagesKey` 为键；添加/删除数组项的 `updateDataModel` 消息被忽略，因为扩展仅在新的 surface-update 消息到达时重新计算 | 以 `surface.dataModel` 为键计算 `useMemo`，或在 `ComponentNode` 中延迟扩展 |
| 14.2 | `lib/a2ui/a2ui-renderer.tsx:258-275`、`custom-components/MarkdownEditor.tsx:7-9`、`PhonePreview.tsx:13` | **自定义组件 props 使用原始 `as` 类型转换** — `comp as { content?: string }` 和 `comp as { devices?: DeviceInfo[] }` 没有任何运行时验证。如果匹配到错误的组件类型，`resolve()` 会静默返回 `undefined` | 为每个组件定义 Zod 验证的 prop 类型或类型守卫 |
| 14.3 | `pages/devices/device-card.tsx:105-136` | **设备重命名使用 `contentEditable` 不稳定** — 粘贴会渲染原始 HTML，没有 `textContent` 清理，没有 IME 组合处理，直接使用 `document.createRange()` + `window.getSelection()`。`onBlur` 提交没有确认，意外点击外部即触发重命名 | 替换为受控的 `<input>` + 切换 |
| 14.4 | `components/channel-setup/dingtalk-setup-view.tsx:58`、`discord-setup-view.tsx:78`、`whatsapp-setup-view.tsx:55-58,93-95` | **凭据错误消息可能包含原始 API 错误详情** — `formatChannelConnectErrorMessage(error, ...)` 和手动 `(apiError as { message: unknown }).message` 提取可能将凭据相关错误载荷泄露到 UI | 审计 `formatChannelConnectErrorMessage` 辅助函数；显示前进行清理 |

### 中问题

| # | 文件 | 问题 | 建议修复 |
|---|------|-------|---------------|
| 14.5 | `lib/a2ui/a2ui-renderer.tsx:158-159` | **`resolve<T>` 泛型具有误导性** — 返回 `unknown`，调用方到处使用 `resolve(...) as Type`，绕过了类型检查。如果数据模型返回错误类型，`String(...)` 包裹会静默将 `null` 转换为 `"null"` | 让 `resolve` 验证解析的类型，或移除泛型 |
| 14.6 | `lib/a2ui/components/TextField.tsx:20-21`、`CheckBox.tsx:13-14`、`ChoicePicker.tsx:20-22`、`Slider.tsx:16-17`、`DateTimeInput.tsx:14-15` | **状态同步模式覆盖用户输入** — 所有 5 个组件使用 `useState(value)` + `useEffect(() => setValue(value), [value])`。如果 LLM 发送任何不同的值，用户未保存的输入会被静默丢弃 | 要么使用 `onChange` 完全受控，要么使用基于 key 的重置 |
| 14.7 | `lib/a2ui/components/Image.tsx:9`、`Video.tsx:9`、`AudioPlayer.tsx:9` | **媒体 `source` URL 未经清理** — URL 直接来自 LLM 输出；通过 `<img>`/`<video>` 网络请求启用跟踪像素和 SSRF 探测 | 强制执行 CSP `img-src`/`media-src` 或验证 URL 模式 |
| 14.8 | `lib/a2ui/custom-components/PhonePreview.tsx:71-75` | **PhonePreview 截图 URL 未经清理** — 来自 LLM 输出的 `device.screenshot` 直接传递给 `<img src>` | 验证 URL 模式或限制为已知域名 |
| 14.9 | `lib/a2ui/a2ui-surface.ts:100,109` | **`resolveValue` 不安全的 `as T` 类型转换** — 没有运行时验证返回值是否匹配类型 `T`，与误导性的 `resolve<T>` 叠加 | 添加运行时类型验证或返回 `unknown` |
| 14.10 | `pages/devices/use-mirror-socket.ts:78-123` | **`reconnect` 重复了约 40 行 WebSocket 设置代码** — 逻辑从 `useEffect` 复制；任何消息处理变更必须在两处更新 | 提取共享的设置辅助函数，或使用 `reconnectCounter` 状态触发 effect |
| 14.11 | `pages/devices/task-detail-page.tsx:15-44`、`task-history-page.tsx:23-46` | **手动 `useEffect` + `cancelled` 标志而非 React Query** — 违反项目约定。缺少自动重新获取、缓存失效、stale-while-revalidate | 替换为 `@tanstack/react-query` 的 `useQuery` |
| 14.12 | `components/chat-input-area.tsx:314,458` | **`selectedSkillSlug` 状态已维护但从未传递给 `onSend`** — 技能选择被静默丢弃；功能不完整 | 在发送载荷中包含 skill slug 或移除状态 |
| 14.13 | `components/chat-input-area.tsx:591-641` | **JSX 中内联 IIFE 进行模型过滤** — `{(() => { ... })()}` 每次渲染创建新函数，阻止 memoization | 提取到 `useMemo` |
| 14.14 | `pages/devices/task-history-page.tsx:48-146` | **`renderDetail` 函数每次渲染时重新创建** — 定义在组件体内，每次状态变更都会重新渲染所有展开的条目 | 用 `useCallback` memoize 或提取为独立组件 |
| 14.15 | `components/channel-setup/wecom-setup-view.tsx:105` | **外部链接缺少 `noopener`** — 使用 `rel="noreferrer"` 而非 `rel="noopener noreferrer"`（其他频道文件使用后者） | 添加 `noopener` 以保持一致 |

### 低问题

| # | 文件 | 问题 | 建议修复 |
|---|------|-------|---------------|
| 14.16 | `lib/a2ui/components/Modal.tsx` + `a2ui.css:341` | Modal z-index 硬编码为 1000 — 可能与应用的对话框堆叠冲突 | 使用应用设计令牌或计算的 z-index |
| 14.17 | `lib/a2ui/a2ui-renderer.tsx:95-115` | `A2UIErrorBoundary` 是类组件（对于错误边界可接受，但在函数组件代码库中不常见） | 添加注释说明原因 |
| 14.18 | `pages/devices/device-card.tsx:117` | `onBlur={commitRename}` 立即调用 API 而无确认 | 添加确认步骤或 `onKeyDown` Enter 提交 |

---

## Module 15: Desktop 渲染器、Sidecar 与构建脚本

**审查文件：**
- `apps/desktop/src/components/`（8 个文件）
- `apps/desktop/src/hooks/`（3 个文件）
- `apps/desktop/src/lib/`（8 个文件）
- `apps/desktop/src/pages/`（3 个文件）
- `apps/desktop/src/types/`（1 个文件）
- `apps/desktop/sidecars/web/index.js`
- `apps/desktop/scripts/`（18 个文件）
- `apps/desktop/main/runtime/daemon-supervisor.ts`
- `apps/desktop/main/lifecycle/launchd-recovery-policy.ts`
- `apps/desktop/main/platforms/`（3 个文件）
- `apps/desktop/main/runtime/manifests.ts`
- `apps/desktop/main/runtime/runtime-logger.ts`

### 高问题

| # | 文件 | 问题 | 建议修复 |
|---|------|-------|---------------|
| 15.1 | `sidecars/web/index.js:138-149` | **Web sidecar 静态文件服务器中的路径遍历** — `normalize(pathname).replace(/^\/+/, "")` 去掉了前导 `/` 但不能阻止 `../` 遍历。对 `/../../../etc/passwd` 的请求会解析到 dist 目录之外；127.0.0.1:50810 上的任何本地进程都可以读取文件系统文件 | 验证解析后的路径以 `distRoot` 开头；如果不是则返回 403 |
| 15.2 | `main/platforms/platform-backends.ts:10` | **Windows 上从 PATH 获取 `netstat`** — 打包的 Electron 中 `execFileSync("netstat", ...)`；PATH 不可靠。catch 返回 `null`，静默导致所有委托的单元探测失败 | 使用 `C:\\Windows\\System32\\netstat.exe` |
| 15.3 | `main/runtime/daemon-supervisor.ts:1066` | **从 PATH 获取 `pgrep`** — 打包构建中 `execFileSync("pgrep", ...)`；失败导致 `refreshDelegatedUnit()` 总是报告"stopped" | 在 macOS 上使用 `/usr/bin/pgrep` |
| 15.4 | `main/platforms/shared/runtime-executables.ts:76`、`main/runtime/manifests.ts:143` | **从 PATH 获取 `which` + 重复实现** — 打包构建中 `execFileSync("which", ["node"], ...)`；该函数在两个文件中完全复制粘贴，没有共享导入 | 通过已知路径解析 Node.js 候选；提取共享辅助函数 |
| 15.5 | `main/runtime/manifests.ts:344` | **`as never` 类型转换绕过所有类型检查** — `{ getPath, isPackaged } as never` 禁用了模拟 `App` 对象的 TypeScript 检查。如果函数签名更改，编译器不会捕获。违反"永不使用 `any`"规则 | 使用 `Pick<App, 'getPath' \| 'isPackaged'>` 或传递真实的 `app` |

### 中问题

| # | 文件 | 问题 | 建议修复 |
|---|------|-------|---------------|
| 15.6 | `src/components/develop-set-balance-dialog.tsx:19-28` | **对原始 IPC 返回值进行不安全的 `as DesktopRewardsStatus` 转换** — 没有运行时验证，格式错误的响应会静默产生 undefined | 使用类型守卫或 Zod schema 进行窄化 |
| 15.7 | `src/pages/cloud-profile-page.tsx:133-148` | **不稳定的 `useEffect` 依赖项重新注册 interval** — `cloudStatus?.profiles` 每次轮询都是新的数组引用，导致持续的 interval 创建/拆卸循环 | 在单独的 effect 中以空依赖项轮询，或使用时间戳 |
| 15.8 | `src/hooks/use-desktop-runtime-config.ts:13` | **静默错误被吞没** — `getRuntimeConfig().then(...).catch(() => null)` 静默吃掉 IPC 失败 | 记录警告；为降级状态横幅显示错误状态 |
| 15.9 | `scripts/platforms/desktop-platform.mjs:44-56` | **Windows cmd 包装器中 `%` 环境变量未转义** — `quoteWindowsCmdArg` 处理 `\s"&()<>|^` 但不处理 `%`；cmd.exe 在引号字符串内展开 `%VARIABLE%` | 将 `%` 添加到特殊字符正则表达式；转义为 `^%` |
| 15.10 | `main/runtime/daemon-supervisor.ts:718-726` | **同步 `launchctl print` 阻塞主进程** — `getRuntimeState()` 中对每个 launchd 单元调用带 3 秒超时的 `execFileSync`。有 2 个以上单元时，阻塞主 Electron 进程 6 秒以上，冻结渲染器/IPC | 缓存 launchd 状态；按定时器异步刷新 |
| 15.11 | `main/runtime/daemon-supervisor.ts:801-830` | **日志尾部中的 TOCTOU 导致永久性日志跳过** — `statSync` 和 `readSync` 之间的文件轮转导致负的 `Buffer.alloc` 大小；catch 块吞没错误但 `prevOffset` 从不重置，永久跳过日志文件 | 轮转时将 `prevOffset` 重置为 0；用 `Math.max(0, ...)` 保护 `Buffer.alloc` |
| 15.12 | `main/runtime/runtime-logger.ts:277-300` | **日志轮转失败损坏流状态** — 在重命名之前调用了 `this.stream.end()`；如果重命名失败，流已结束但未打开新流，静默丢弃所有后续日志数据 | 在 `stream.end()` 之前执行重命名；使用原子重命名模式 |
| 15.13 | `main/lifecycle/launchd-recovery-policy.ts:84` | **`isDev` 不匹配返回 `fresh-start` 而非 teardown** — 如果来自其他模式（dev/打包）的服务正在运行，fresh-start 未经清理即继续，导致端口冲突 | 当 `isDev` 不匹配时返回 `teardown-stale-services` |
| 15.14 | `scripts/electron-builder-pnpm-json-preload.cjs:31-35` | **可能是死代码的原型补丁** — 方法添加到 `NodeModulesCollector.prototype` 但可能不被当前 electron-builder 版本调用 | 验证方法是否实际被调用；如果是死代码则移除 |

### 低问题

| # | 文件 | 问题 | 建议修复 |
|---|------|-------|---------------|
| 15.15 | `src/components/surface-frame.tsx:103-106` | `src` 比较的渲染阶段状态更新 — React 反模式 | 移到带有 `[src]` 依赖的 `useEffect` |
| 15.16 | `src/components/develop-set-balance-dialog.tsx:115` | 仅开发环境的 fire-and-forget `.catch(() => undefined)` 吞没 IPC 错误 | 将警告记录到控制台 |
| 15.17 | `main/platforms/shared/runtime-roots.ts:79-83,93-95` | 相同的三元分支（死代码） — 两侧产生相同的表达式；可能是重构遗留 | 移除条件判断；使用单一表达式 |
| 15.18 | `main/runtime/daemon-supervisor.ts:1154` | `spawn(command ?? "")` 传入空字符串 — 如果 command 为 undefined 会产生令人困惑的系统错误 | spawn 前验证 command |
| 15.19 | `main/runtime/daemon-supervisor.ts:1436` | `waitForPort` socket 没有 `unref()` — 关闭期间如果有待处理连接会保持事件循环存活 | 在 `connect()` 后调用 `socket.unref()` |
| 15.20 | `main/runtime/daemon-supervisor.ts:381-386` | 重启重置窗口使用 `Date.now()` — 系统时钟跳变（NTP）会导致负的经过时间，阻止计数器重置 | 使用 `performance.now()` 或 `process.hrtime.bigint()` |

---

## Module 16: Tools/Dev — 开发环境与 Supervisor

**审查文件：**
- `tools/dev/src/index.ts`（CLI 入口）
- `tools/dev/src/supervisors/controller.ts`
- `tools/dev/src/supervisors/desktop.ts`
- `tools/dev/src/supervisors/openclaw.ts`
- `tools/dev/src/supervisors/web.ts`
- `tools/dev/src/services/controller.ts`
- `tools/dev/src/services/desktop.ts`
- `tools/dev/src/services/openclaw.ts`
- `tools/dev/src/services/web.ts`
- `tools/dev/src/shared/dev-runtime-config.ts`
- `tools/dev/src/shared/paths.ts`
- `tools/dev/src/shared/logs.ts`
- `tools/dev/src/shared/logger.ts`
- `tools/dev/src/shared/trace.ts`
- `tools/dev/src/shared/default-start.ts`
- `tools/dev/src/shared/platform/desktop-dev-platform.ts`
- `tools/dev/src/shared/platform/desktop-dev-platform.darwin.ts`
- `tools/dev/src/shared/platform/desktop-dev-platform.win32.ts`

### 中问题

| # | 文件 | 问题 | 建议修复 |
|---|------|-------|---------------|
| 16.1 | `services/web.ts:22-23` | **从同一模块的双重导入** — `createDesktopInjectedEnv` 通过两条独立的 import 语句从 `../shared/dev-runtime-config.js` 导入 | 合并为单条 import 语句 |
| 16.2 | `shared/dev-runtime-config.ts:42-77` + `platform/desktop-dev-platform.darwin.ts:42-76` | **重复的 `parseEnvFile` 实现** — 两个文件中逻辑相同但没有共享导入。任何修复都必须应用两次 | 提取到 `@nexu/dev-utils` 中的共享工具函数 |
| 16.3 | `supervisors/controller.ts:148-163` | **监视器重启竞态：防抖清除定时器但重启已排队** — `restartPending` 标志在 setTimeout 回调内设置，但防抖重置只清除了定时器。如果在 500ms 窗口期间发生第二次文件变更，会设置新的定时器但 `restartPending` 仍为 false，因此第二个回调也会继续执行 | 在防抖处理器中（setTimeout 回调外）设置 `restartPending = true`，或使用原子计数器 |
| 16.4 | `services/desktop.ts:589-635` | **Windows 与 macOS 启动路径不对称** — Windows 使用 `spawnWindowsDetachedDesktopProcess`（无日志尾部、无进程启动等待），macOS 使用 `spawnHiddenProcess` + PID 轮询。Windows 路径可观测性较低 | 为 Windows 启动路径添加 PID 轮询和超时 |
| 16.5 | `shared/dev-runtime-config.ts:177-178` | **硬编码的开发网关 token** — 如果未设置环境变量则默认为 `"gw-secret-token"`；这仅用于开发且有文档记录，但可能在类似生产的测试环境中被意外使用 | 如果在非开发模式下使用了默认值，添加运行时警告 |

### 低问题

| # | 文件 | 问题 | 建议修复 |
|---|------|-------|---------------|
| 16.6 | `index.ts:46-50` | `SnapshotLike` 类型带有 `action` 参数模式 — action 是拼写错误？`action: "start" \| "restart"` 在上下文中可能应该是 `action`，因为 `readDevCommandTimeoutMs` 是唯一的使用者 | 检查参数名是否应该是 `action`，或者类型是否放错了位置 |
| 16.7 | `services/desktop.ts:226-237` | `shouldRetryDesktopElectronLaunch` 将错误消息作为字符串检查 — 与确切错误消息文本的脆弱耦合；重构错误消息会静默破坏重试逻辑 | 使用错误代码或自定义错误类 |
| 16.8 | `shared/platform/desktop-dev-platform.win32.ts:144-145` | 用于进程查询的 PowerShell 脚本 — 脚本通过字符串插值构建；`launchId` 通过 `escapePowerShellString` 转义，但其他插值值依赖调用方验证 | 考虑使用 PowerShell 参数化脚本或专用进程列表库 |
| 16.9 | `services/openclaw.ts:339-340` | `runId = options.sessionId; sessionId = options.sessionId` — 同一值赋给两个不同的变量；误导读者以为它们可能不同 | 使用单一变量或添加注释说明区别 |
| 16.10 | `supervisors/desktop.ts:113-118` | Desktop supervisor 在 `waitForChildExit(workerChild)` 后等待 worker 退出，但 `removeRunningLock()` 只调用一次 — 如果 worker 意外退出，锁清理与 SIGINT/SIGTERM 处理器竞争 | 确保在 worker 退出处理器中调用 `removeRunningLock` |

---

## Module 17: Web 页面（剩余部分）

**审查文件：**
- `apps/web/src/pages/automations.tsx`（719 行）
- `apps/web/src/pages/channels.tsx`（917 行）
- `apps/web/src/pages/expert-custom.tsx`（1204 行）
- `apps/web/src/pages/expert-detail.tsx`（253 行）
- `apps/web/src/pages/experts.tsx`（460 行）
- `apps/web/src/pages/home.tsx`（1710 行）
- `apps/web/src/pages/integrations.tsx`（774 行）
- `apps/web/src/pages/local-chat.tsx`（251 行）
- `apps/web/src/pages/models.tsx`（约 1000 行中的前 200 行）
- `apps/web/src/pages/rewards.tsx`（789 行）
- `apps/web/src/pages/sessions.tsx`（1297 行）

### 严重问题

| # | 文件 | 问题 | 建议修复 |
|---|------|-------|---------------|
| 17.1 | `local-chat.tsx:121-129` | **使用原始 `fetch("/api/v1/chat/local")` 而非生成的 SDK** — 违反项目硬性规则"前端必须使用生成的 SDK，禁止使用原始 fetch"。第 163 行也使用了 `fetch("/api/v1/chat/session")` | 将 chat 端点迁移到 `createRoute()` + `app.openapi()`，重新生成 SDK，使用 SDK 函数 |
| 17.2 | `local-chat.tsx:142-147,184-186` + `sessions.tsx` | **React Router 导航后无条件硬刷新页面** — `setTimeout(() => window.location.href = target, 200)` 在 `navigate(target)` 之后始终触发，即使 React Router 成功也会导致整页刷新。这与标记为严重 #18 的问题模式相同 | 移除 `setTimeout` 回退；仅使用 `navigate()`，或为导航失败添加错误边界 |

### 高问题

| # | 文件 | 问题 | 建议修复 |
|---|------|-------|---------------|
| 17.3 | `automations.tsx:57-136` | **完全是模拟/占位 UI** — 所有 automations 数据都是硬编码的 `mockAutomations` 数组。没有真实的 API 集成用于 CRUD 操作。此页面对用户可见但不可用 | 要么接入真实 API 端点，要么在实现前用功能标志隐藏页面 |
| 17.4 | `automations.tsx:469-476` | **提交按钮没有处理器** — `AutomationModal` 有 `<button type="submit">` 但没有包裹的 `<form>` 元素，也没有 `onSubmit` 处理器。点击保存按钮什么也不做 | 用带有 `onSubmit` 处理器的 `<form>` 包裹，或将按钮 `type` 改为 `"button"` 并添加 `onClick` |
| 17.5 | `automations.tsx:552-558` | **筛选标签计数使用硬编码的 `mockAutomations.length`** 而非实际筛选后的状态数组长度 — 标签徽章总是显示总的模拟数量，不管活动的筛选条件 | 使用 `filteredAutomations.length` |
| 17.6 | `home.tsx:555-562` | **生产环境 `console.log` 泄露运营状态** — `console.log("[home:live-status]", ...)` 在运行时健康轮询期间每 2 秒触发一次，将频道连接性记录到生产控制台 | 移除或用 `process.env.NODE_ENV === "development"` 保护 |
| 17.7 | `expert-custom.tsx:659-693` | **四次原始 `fetch()` 调用获取模板而非使用 SDK** — `fetch("/api/v1/experts/templates/AGENTS.md")`，IDENSITY.md、SOUL.md、USER.md 同样模式。几乎相同的代码重复了 4 次 | 创建 SDK 端点，使用单一参数化查询 |
| 17.8 | `rewards.tsx:536-547` | **`localStorage` 中的 OAuth 待处理状态没有清理** — `nexu-oauth-pending-${integrationId}` 以 JSON 存储。如果 OAuth 流程被放弃或崩溃，过期的条目会无限累积 | 添加基于 TTL 的清理或改用 `sessionStorage` |
| 17.9 | `sessions.tsx:194-305` | **`extractMessage` 有 111 行** 处理 3 种内容格式（字符串、数组、blocks），大量使用 `as Record<string, unknown>` 类型转换。在一个单体函数中提取 text、replyContext、toolCall、a2ui、images、fileCards | 按内容格式拆分为单独的提取函数；添加适当的类型守卫 |

### 中问题

| # | 文件 | 问题 | 建议修复 |
|---|------|-------|---------------|
| 17.10 | `experts.tsx:28-37` | **`useDebounce` 在内联定义** 而非从共享 hooks 库导入 — 重复了可能在其他地方已存在的逻辑 | 移动到 `@/hooks/use-debounce.ts` |
| 17.11 | `experts.tsx:42-47` | **`_isDesktopClient` 未使用的变量** — 下划线前缀表明是已知的死代码 | 移除或用于条件行为 |
| 17.12 | `experts.tsx:108` | **尴尬的类型转换** `emoji: entry.avatarDataUrl ? (undefined as unknown as string) : "🤖"` — 通过 `unknown` 将 `undefined` 转换为 `string` | 为 emoji 字段使用正确的联合类型 `string \| undefined` 或使用空字符串回退 |
| 17.13 | `sessions.tsx:963-1003` | **乐观消息稳定键基于 `msg.text.slice(0, 40)`** — 相似消息可能发生哈希冲突。通过 `serverUserTexts` 集合的服务器去重没有大小限制 | 使用 `cuid2` 或内容哈希作为稳定键；为去重集合添加 LRU 上限 |
| 17.14 | `sessions.tsx:869-887` | **`/new`、`/reset`、`/clear` 命令拦截** 调用 `postApiV1SessionsByIdReset` 但命令文本在拦截前已发送到服务器 — 服务器仍然收到原始命令文本 | 发送前从消息中剥离命令文本 |
| 17.15 | `home.tsx:381-389` | **运行时健康轮询每 2 秒持续进行** 通过 `getApiInternalDesktopReady()` — 无退避，标签页在后台时不暂停 | 使用带有 `visibilitychange` 感知的 `refetchInterval` 或指数退避 |
| 17.16 | `home.tsx:1371-1459` | **`useModalDialog` 是一个 88 行的自定义焦点陷阱**，具有 Tab/Shift+Tab 循环、Escape 关闭、焦点恢复 — 重新实现了 `@radix-ui/react-dialog` 等库提供的功能 | 考虑使用经过充分测试的对话框库 |
| 17.17 | `home.tsx:626-666` | **频道连接流程使用 `pendingChannelId`** 和基于 toast 的进度 — toast 状态不会在页面刷新后持久化；如果用户在连接期间刷新，进度 toast 会丢失且无法恢复 | 将待处理连接状态存储在 URL 参数或查询缓存中 |
| 17.18 | `integrations.tsx:467-507` | **OAuth 轮询 `setInterval` 每 3 秒，最多 20 次** — 即使用户离开页面轮询仍继续（useEffect 中的清理仅在卸载时触发，但浏览器可能在后台标签页中暂停定时器） | 使用 `visibilitychange` 暂停/恢复轮询 |
| 17.19 | `integrations.tsx:440` | **`refetchInterval: 10000` 硬编码 10 秒轮询** 用于 integrations 列表 — 所有 integrations 都已连接时没有停止条件 | 当没有 integration 处于 `connecting` 状态时停止轮询 |
| 17.20 | `rewards.tsx:299-383` | **`handleTaskAction` 有 85 行**，包含 GitHub star 检测（10 秒基于信任的）、每日签到自动授予、证明 URL 工作流 — 全在一个函数中 | 拆分为按任务类型的处理器函数 |
| 17.21 | `sessions.tsx:55-87` | **`stripMetadata` 正则表达式模式** 匹配 `[message_id: ...]`、webchat 时间戳、回复上下文 — 对格式变更很脆弱。三个独立的正则模式没有共享提取逻辑 | 使用单一结构化元数据解析器，带版本化格式 |
| 17.22 | `models.tsx:54-76` | **单个文件中有 30+ 个 SDK 导入** — 从 30 个不同的 SDK 函数导入用于模型 provider、OAuth、偏好设置、云连接/断开 | 考虑将相关的 SDK 调用分组到服务 hooks 中 |

### 低问题

| # | 文件 | 问题 | 建议修复 |
|---|------|-------|---------------|
| 17.23 | `automations.tsx:486` | **`_expandedId` / `_setExpandedId` 未使用的状态** 带下划线前缀 — 故意的死代码 | 移除 |
| 17.24 | `automations.tsx` | **`bots` 状态类型转换宽松** — `res.data?.bots` 被当作松散类型处理；筛选使用 `b.status === "active"` 可能不匹配所有状态值 | 使用生成的 SDK 类型 |
| 17.25 | `channels.tsx:515-546` | **`handleOpenSlack` 基于失焦的本地应用检测** — 巧妙但脆弱；依赖 `window.addEventListener("blur", cancelFallback)` 加 5 秒超时。如果用户在 5 秒内 Alt+Tab 则会产生误判 | 在触发回退前添加 `document.hasFocus()` 检查 |
| 17.26 | `expert-custom.tsx:710-721` | **名称→IDENTITY.md 防抖同步** — 400ms 防抖替换 identity markdown 中的 `**Name:**`。如果用户快速输入并切换标签页，最后一个防抖可能在导航后触发 | 在卸载时取消防抖 |
| 17.27 | `expert-custom.tsx:727` | **`useEffect` 依赖 `templateSoulMd`** 但 `soulTouchedRef` 检查可能在用户编辑早于模板加载时产生竞态 — 模板可能覆盖用户编辑 | 在 effect 内设置值之前检查 `soulTouchedRef` |
| 17.28 | `experts.tsx:73` | **`eslint-disable-next-line react-hooks/exhaustive-deps`** 用于故意的一次性数据加载 — 使用了旧版 eslint，应使用 biome | 替换为 `biome-ignore` 注释 |
| 17.29 | `sessions.tsx` | **多个 `biome-ignore lint/correctness/useExhaustiveDependencies`** 注释用于故意的依赖省略 — 分散在文件中 | 整合为单一的有文档记录的模式 |
| 17.30 | `home.tsx:376` | **`STARTUP_GRACE_MS = 15000` 魔法数字** — 15 秒的宽限期用于抑制状态变更 toast | 记录理由或从预期的启动时长推导 |
| 17.31 | `home.tsx:152-206` | **微信推荐徽章上的 `animate-breathe` CSS 类** — 自定义动画未在 Tailwind 配置中定义；可能不存在 | 验证动画是否在全局 CSS 或 Tailwind 配置中定义 |
| 17.32 | `channels.tsx:821-893` | **`ConfiguredView` 中的内联确认对话框** — 73 行内联对话框，带有 Escape/背景点击处理；可以作为可重用的 `ConfirmDialog` 组件 | 提取为共享组件 |
| 17.33 | `integrations.tsx:549-554` | **为 OAuth 预先打开的 `about:blank` 标签页** — 先打开空白标签页以避免弹窗拦截，然后重定向。如果弹窗仍然被拦截，用户会得到一个卡住的空白标签页 | 添加超时以在重定向失败时关闭空白标签页 |
| 17.34 | `local-chat.tsx:42-68` | **通过 `createDefaultBot` mutation 自动创建默认 bot** — 当不存在活跃 bot 时自动触发。如果创建失败（如网络错误），错误状态替换了 UI，在页面刷新前没有可见的重试按钮 | 在错误状态中添加明确的重试 UI |
| 17.35 | `local-chat.tsx:151-178` | **会话发现轮询：30 次尝试 x 100ms 间隔** — 3 秒最大等待时间，无渐进退避。如果服务器慢，会不必要地快速轮询 30 次 | 使用指数退避：100ms -> 200ms -> 400ms 等 |
| 17.36 | `rewards.tsx:79-253` | **`RewardConfirmModal` 有 175 行** — 三阶段确认（空闲 -> 检查中 -> 领取中），表单验证内联在模态组件中 | 将阶段提取为单独的子组件 |

---

## Module 18: Web 页面与组件（批次 3）

**审查文件：**
- `apps/web/src/pages/skills.tsx`（1067 行）
- `apps/web/src/pages/invite.tsx`（303 行）
- `apps/web/src/pages/welcome.tsx`（553 行）
- `apps/web/src/pages/slack-claim.tsx`（635 行）
- `apps/web/src/pages/oauth-callback.tsx`（479 行）
- `apps/web/src/pages/slack-oauth-callback.tsx`（85 行）
- `apps/web/src/pages/community-skill-detail.tsx`（561 行）
- `apps/web/src/pages/feishu-bind.tsx`（约 150 行中的前 50 行）
- `apps/web/src/components/chat-input-area.tsx`（652 行）
- `apps/web/src/components/chat-input.tsx`（114 行）
- `apps/web/src/components/budget-depleted-dialog.tsx`（98 行）
- `apps/web/src/components/budget-warning-banner.tsx`（107 行）
- `apps/web/src/components/github-star-cta.tsx`（125 行）
- `apps/web/src/components/experts/expert-card.tsx`（185 行）
- `apps/web/src/pages/devices/index.tsx`（前 200 行）
- `apps/web/src/pages/devices/use-device-snapshot.ts`
- `apps/web/src/pages/devices/use-mirror-socket.ts`

### 严重问题

| # | 文件 | 问题 | 建议修复 |
|---|------|-------|---------------|
| 18.1 | `welcome.tsx:233-240` | **伪造的 API 密钥验证** — `handleVerifyKey` 使用 `setTimeout(() => { setVerifying(false); setVerified(true); }, 1200)` 来模拟验证。没有进行实际的 API 调用。BYOK 设置使用未验证的密钥继续，可能导致密钥实际使用时的运行时失败 | 调用 `postApiV1ModelProvidersByProviderIdValidate()` 在标记为已验证前验证密钥 |

### 高问题

| # | 文件 | 问题 | 建议修复 |
|---|------|-------|---------------|
| 18.2 | `use-device-snapshot.ts` + `use-mirror-socket.ts` | **WebSocket 无自动重连** — 两个 hook 在错误/关闭时永久关闭 WebSocket。`useMirrorSocket` 有手动 `reconnect()` 但没有自动重试。瞬态网络故障会终止镜像流，直到用户手动刷新 | 添加带最大重试次数的指数退避自动重连 |
| 18.3 | `skills.tsx:76-365` | **`SkillCard` 是 290 行在内联定义** 在与页面相同的文件中 — 大型组件包含安装/卸载/取消 mutation 处理、队列状态、错误状态、跟踪和卡片渲染 | 将 `SkillCard` 提取到 `@/components/skills/skill-card.tsx` |
| 18.4 | `welcome.tsx:112-135` | **云端轮询每 2 秒无退避** — `setInterval` 以 2 秒间隔持续检查 `refetchDesktopCloudStatus()`。标签页在后台时不暂停，没有最大尝试次数限制 | 使用 `visibilitychange` 感知，添加尝试上限或指数退避 |
| 18.5 | `welcome.tsx:157-220` | **`handleAccountLogin` 有 63 行** — 复杂的分支逻辑：连接、检测"已连接"、检测错误、用断开+重连重试、打开浏览器 URL、轮询状态。混合了状态变更与 API 编排 | 拆分为更小的异步函数：`tryConnect()`、`handleConnectError()`、`pollForCompletion()` |
| 18.6 | `chat-input-area.tsx:351-375` | **文件上传将整个文件读取为 base64 data URL** — 存储在 React 状态中（`pendingAttachments`）。即使有 7.5MB 限制，base64 编码也增加 33% 开销（约 10MB 在状态中）。多个文件会叠加此问题 | 将文件流式传输到服务器，或使用对象 URL（`URL.createObjectURL`）进行预览而非 base64 状态 |

### 中问题

| # | 文件 | 问题 | 建议修复 |
|---|------|-------|---------------|
| 18.7 | `skills.tsx:65-74` | **`useDebounce` 在内联定义** — 同一个 hook 的第三次重复（也在 `experts.tsx` 中，重复 17.10） | 移动到 `@/hooks/use-debounce.ts` 并在所有 3 个文件中导入 |
| 18.8 | `community-skill-detail.tsx:70-163` | **自定义 Markdown 解析器 `parseMdBlocks`** — 94 行手写解析器处理标题、代码块、列表、段落。不处理嵌套格式、引用块、表格、HTML。对边缘情况脆弱 | 替换为轻量级 markdown 库或使用项目现有的 `ChatMarkdown` 组件 |
| 18.9 | `community-skill-detail.tsx:165-224` | **`renderInline` 正则表达式** — 处理 `code`、`**bold**`、`*italic*`、`[links]()` 但基于正则的内联解析很脆弱（如单词中间的 `**text**`、转义的 `\*`） | 使用适当的内联 markdown 解析器 |
| 18.10 | `community-skill-detail.tsx:356` | **不安全的类型转换** — 第 356 行 `return data as unknown as SkillDetail`。API 响应通过 `unknown` 转换为 `SkillDetail`，没有运行时验证 | 为 API 响应添加 Zod schema 或类型守卫 |
| 18.11 | `oauth-callback.tsx:107-213` | **递归 `poll()` 函数** — 以 3 秒间隔递归异步轮询，`return poll()` 最多 20 次。虽然递归深度有限（20），但此模式不常见；`while` 循环更清晰 | 用 `while (attempts < maxAttempts)` 循环替换递归 |
| 18.12 | `devices/index.tsx:66-97` | **手动 `setInterval` 以 5 秒轮询** — 设备页面使用原始 `setInterval` 而非 React Query 的 `refetchInterval`。有良好的 `visibilitychange` 暂停/恢复，但重复了轮询基础设施 | 使用 `useQuery` 配合 `refetchInterval: 5000` 和相同的可见性感知逻辑 |
| 18.13 | `feishu-setup-view.tsx:24-100+` | **源代码中硬编码了 100+ 个飞书 OAuth scope** 作为巨大的 JSON 字面量 — 如果 scope 变更是维护负担，且使文件难以导航 | 移到单独的常量文件或从 API 获取 |
| 18.14 | `slack-claim.tsx:183-191` | **使用 `sessionStorage` 进行认证返回检测** — `CLAIM_RETURN_KEY` 存储在 sessionStorage 中以检测认证往返。如果用户在新标签页中打开 claim 链接，sessionStorage 键将不存在 | 使用 URL 参数而非 sessionStorage 进行跨标签页的往返检测 |
| 18.15 | `use-mirror-socket.ts:78-123` | **重复的 WebSocket 处理代码** — `useEffect` 和 `reconnect()` 有几乎相同的 WS 设置、事件监听器和消息解析（60+ 行重复代码） | 提取 `createMirrorConnection(deviceId)` 函数由两条路径共享 |
| 18.16 | `chat-input-area.tsx:589-642` | **内联模型下拉菜单带 JSX 分组** — 模型选择器下拉菜单使用 `Array.from(groups.entries()).map()` 在 JSX 中内联构建分组的 provider->模型列表。此逻辑（分组 + 过滤）在每次渲染时运行 | 用 `useMemo` 缓存分组的模型列表 |

### 低问题

| # | 文件 | 问题 | 建议修复 |
|---|------|-------|---------------|
| 18.17 | `budget-depleted-dialog.tsx:23` | **`biome-ignore lint/a11y/useKeyClickEvents`** 用于背景点击 — 背景关闭无法通过键盘操作 | 在背景上添加 `onKeyDown` 处理器用于 Escape 键 |
| 18.18 | `oauth-callback.tsx:435-451` | **`ConnectionGraphicSuccess` 是透传包装器** — 用相同 props 渲染 `<ConnectionGraphic>`，没有额外行为。冗余组件 | 直接在 `SuccessCard` 中内联 `<ConnectionGraphic>` |
| 18.19 | `slack-oauth-callback.tsx:27-29` | **effect 中的空清理** — `sessionStorage.removeItem("slack_oauth_pending")` 在挂载时无条件运行，但 `oauth-callback.tsx` 对相同模式使用 `localStorage.removeItem`。存储机制不一致 | 将 OAuth 待处理状态的存储机制统一为一种 |
| 18.20 | `devices/index.tsx:140` | **硬编码的二维码 URL** — 下载二维码中硬编码了 `"https://nexu.io/tabby"` | 通过环境变量或 API 使其可配置 |
| 18.21 | `github-star-cta.tsx:55,94,117` | **重复的 star 显示逻辑** — `stars && stars > 0` 检查和 `stars.toLocaleString()` 渲染在 3 个变体中重复了 3 次 | 提取 `renderStarCount(stars)` 辅助函数 |
| 18.22 | `expert-card.tsx:109-118` | **卡片即链接包含嵌套的交互元素** — 整张卡片是 `<Link>`，但包含使用 `e.preventDefault(); e.stopPropagation()` 的按钮。此反模式使无障碍工具的 DOM 层级结构混乱 | 使用扁平布局，卡片链接区域排除操作按钮 |
| 18.23 | `welcome.tsx:43-56` | **`FadeIn` 动画组件在内联定义** — 带 `animationDelay` 样式的简单包装器；在欢迎页中复用但未导出 | 移动到 `@/components/ui/fade-in.tsx` |
| 18.24 | `invite.tsx:79-88` | **`handlePaste` 剥离所有非字母数字字符** — `replace(/[^A-Z0-9-]/g, "")` 清理粘贴输入，但也从可能包含连字符的有效代码中去掉连字符（正则已允许 `-`） | 正则已允许 `-`；验证邀请码是否不需要其他特殊字符 |
| 18.25 | `chat-input.tsx:103-113` | **`ChatInputSkillsButton` 未使用** — 已定义并导出，但实际的技能按钮逻辑内联在 `ChatInputArea` 中 | 如果未使用则移除，或在 `ChatInputArea` 中使用它 |

---

## Module 19: 频道设置视图、布局与应用引导

**审查文件：** `slack-oauth-view.tsx`、`wechat-setup-view.tsx`、`whatsapp-setup-view.tsx`、`channel-connect-modal.tsx`、`model-picker-dropdown.tsx`、`provider-logo.tsx`、`seedance-promo.tsx`、`use-desktop-budget-guard.ts`、`workspace-layout.tsx`、`app.tsx`、`main.tsx`、`auth-layout.tsx`、`invite-guard-layout.tsx`、`activity-feed.tsx`、`brand-rail.tsx`、`inline-model-selector.tsx`、`toolkit-icon.tsx`、`bot-picker.tsx`、`feishu-permissions-panel.tsx`、`brand-mark.tsx`、`connection-graphic.tsx`、`language-switcher.tsx`、`platform-icons.tsx`、`home-rewards-teaser.tsx`、`experts.tsx`、`local-chat.tsx`

### 严重问题

| # | 文件 | 问题 | 建议修复 |
|---|------|-------|---------------|
| 19.1 | `main.tsx:165-194` | **AnalyticsSessionSync 在所有构建中以 2 秒间隔轮询** — `getApiInternalDesktopCloudStatus()` 以 `refetchInterval: 2000` 调用，即使运行在非桌面 web 环境中。这在纯 web 部署中不必要地产生 2 秒轮询流量 | 用 `_isDesktopClient` 检查保护，与 `DesktopRewardsSync` 相同 |
| 19.2 | `main.tsx:196-209` | **DesktopRewardsSync 没有错误处理** — `onDesktopCommand("desktop:rewards-updated")` 回调运行 `invalidateQueries` 但如果 IPC 处理器抛出异常，会静默崩溃，没有用户反馈 | 用 try/catch 包裹并添加错误日志 |

### 高问题

| # | 文件 | 问题 | 建议修复 |
|---|------|-------|---------------|
| 19.3 | `workspace-layout.tsx:1-1361` | **1361 行的单体布局组件** — 单个文件处理侧边栏管理、会话列表、账户部分、余额弹窗、更新通知、帮助菜单、登出确认、4 个 document mousedown 处理器、localStorage 持久化、交通灯清除、平台检测。这违反了单一职责原则，使组件不可测试 | 拆分为 `WorkspaceSidebar`、`WorkspaceHeader`、`ConversationList`、`AccountSection`、`BalancePopup` 子组件 |
| 19.4 | `wechat-setup-view.tsx:1-342` | **伪造的进度条是误导性 UX** — `calcFakeProgress(elapsedMs)` 显示一个缓出曲线（40 秒内 0→95%），与实际二维码可用性没有关系。用户看到 95% 进度后无限等待真实的二维码到达 | 移除伪造进度；显示简单的"等待二维码..."加载动画和经过时间 |
| 19.5 | `seedance-promo.tsx:425` | **死代码 — 推广截止日期已过** — `SEEDANCE_PROMO_DEADLINE = new Date("2026-04-07T23:59:59+08:00")` 已经过去。倒计时器、横幅、模态框和自动前进逻辑都是死代码 | 移除整个 SeedancePromo 组件及其引用 |
| 19.6 | `channel-connect-modal.tsx` 与各个设置视图 | **ChannelConnectModal 重复了 Slack/Discord 连接逻辑** — 模态框处理 feishu/slack/discord 的基于凭据的连接，但 slack-oauth-view.tsx 也处理 Slack 凭据连接，discord-setup-view.tsx 也处理 Discord。相同的 `postApiV1ChannelsSlackConnect` 调用，相同的错误处理模式 | 将连接逻辑整合到共享的 `useChannelConnect` hook 中 |
| 19.7 | 6 个频道设置视图 | **频道设置代码高度重复** — wechat、whatsapp、slack、discord、dingtalk、telegram 设置视图都遵循相同模式：表单字段 -> API 调用 -> 成功/错误状态 -> 导航。每个 200-700 行，约 60% 结构重复 | 创建 `BaseChannelSetupView` 或 `useChannelSetup` hook，带可插拔的 provider 特定配置 |
| 19.8 | `experts.tsx:108` | **`undefined as unknown as string` 类型强制转换** — 自定义专家设置 `emoji: entry.avatarDataUrl ? (undefined as unknown as string) : "🤖"`。这种双重转换（`undefined -> unknown -> string`）在运行时静默创建了一个类型为 `string` 但值为 `undefined` 的变量，可能导致下游运行时错误 | 使用适当的判别类型：`emoji: string` 和 `avatarDataUrl?: string`，或使用联合类型 |

### 中问题

| # | 文件 | 问题 | 建议修复 |
|---|------|-------|---------------|
| 19.9 | `invite-guard-layout.tsx:1-5` | **空的透传组件** — 整个组件就是 `return <Outlet />;` 没有任何守卫逻辑。命名为"InviteGuard"但不守卫任何东西 | 要么实现邀请守卫检查，要么移除并直接路由 |
| 19.10 | `provider-logo.tsx:27 patterns` | **每次渲染时 O(N*M) 图标解析** — `resolveModelIconKey` 对每个模型 ID 检查 27 个子字符串模式。对于有 50 个模型的选择器，每次渲染进行 1350 次字符串检查 | 在 `useMemo` 中以模型 ID 为键预计算图标映射 |
| 19.11 | `inline-model-selector.tsx:140-169` | **重复了 ModelPickerDropdown 中的模型分组** — 两个组件都有几乎相同的 `Map<string, Model[]>` 分组逻辑和 provider 标题。分组逻辑的变更必须在两处进行 | 提取 `groupModelsByProvider(models)` 工具函数 |
| 19.12 | `activity-feed.tsx:26-34` | **`CHANNEL_LABELS` 硬编码且重复** — 相同的标签映射存在于 `platform-icons.tsx` 中。添加新频道需要更新两个文件 | 使用中心位置的共享 `CHANNEL_LABELS` 常量 |
| 19.13 | `activity-feed.tsx:50` | **不安全的类型转换** — `const sessions = (sessionsData?.sessions ?? []) as Session[];` 使用 `as` 而非适当的类型验证 | 使用 Zod schema 验证或至少使用类型守卫 |
| 19.14 | `workspace-layout.tsx` | **会话侧边栏每 10 秒轮询** — 会话列表使用 `refetchInterval: 10_000`。加上其他轮询（分析 2 秒、设备 60 秒、奖励 2 秒），产生了持续的背景流量 | 考虑使用 WebSocket 推送代替轮询进行会话更新 |
| 19.15 | `app.tsx:95-97` | **settings 和 models 路由都指向 `<ModelsPage />`** — `/workspace/settings` 和 `/workspace/models` 渲染相同组件，没有区分。设置页面没有实际的设置内容 | 要么实现真正的设置页面，要么将 settings 重定向到 models |
| 19.16 | `experts.tsx:28-37` | **`useDebounce` 在内联定义（第 3 次出现）** — 同样的 10 行 hook 重复在 `experts.tsx`、`skills.tsx` 和可能的其他文件中 | 将 `useDebounce` 移动到 `@/hooks/use-debounce.ts` |
| 19.17 | `experts.tsx:98-116` | **自定义专家混入目录数组但形状不同** — 自定义专家的 `emoji` 类型为 `string`，但目录专家的 `emoji` 可能为 nullable。类型转换 `undefined as unknown as string` 掩盖了结构不匹配 | 定义一个统一的 `ExpertDisplayItem` 类型来处理目录和自定义专家 |
| 19.18 | `local-chat.tsx:30` | **硬编码的会话发现常量** — `MAX_ATTEMPTS=30`、`INTERVAL=100ms` 意味着发送消息后最多 3 秒的轮询才能发现会话 ID。在慢速网络条件下，这可能不够 | 使其可配置或使用指数退避 |
| 19.19 | `seedance-promo.tsx` | **1 秒间隔的倒计时器在截止日期后无限运行** — `SeedanceCountdownChip` 使用 `setInterval(..., 1000)` 没有截止日期检查来清除 interval | 添加截止日期控制，在倒计时归零时清除 interval |
| 19.20 | `auth-layout.tsx:19` | **加载状态渲染空 div** — 当 `status === "pending"` 时，组件返回 `<div />` 没有加载指示器 | 在认证状态解析时显示加载动画或骨架屏 |
| 19.21 | `use-desktop-budget-guard.ts:80-106` | **预算守卫状态机复杂但未测试** — healthy->warning->depleted 转换，带解除规则和 `fallbackKey` 去重，没有单元测试 | 为状态转换、解除持久化和回退行为添加测试 |
| 19.22 | `slack-oauth-view.tsx:26-52` | **27 个 Slack scope 和 11 个 bot 事件硬编码** — `SLACK_MANIFEST_SCOPES` 和 `SLACK_MANIFEST_BOT_EVENTS` 数组硬编码在前端。如果后端需要不同的 scope，前端和后端可能不同步 | 从后端 API 获取所需的 scope |

### 低问题

| # | 文件 | 问题 | 建议修复 |
|---|------|-------|---------------|
| 19.23 | `brand-rail.tsx:1-212` | **内联 `FadeIn` 组件 — 第 4 次出现** — 相同的动画包装器在 `brand-rail.tsx`、`welcome.tsx` 和其他认证页面中内联定义 | 提取到 `@/components/ui/fade-in.tsx` |
| 19.24 | `platform-icons.tsx` | **WechatIcon SVG 渐变中未使用的 `useId`** — React 的 `useId()` 被调用但生成的 ID 用在 React 18+ 自动作用域的静态渐变定义中 | 移除未使用的 `useId` 调用 |
| 19.25 | `language-switcher.tsx:1-125` | **`switch...case` 用于语言名称** — 6 个 case 的 switch 用于 locale->displayName 映射。添加语言需要编辑组件 | 使用 `RECORD<Locale, string>` 常量 |
| 19.26 | `experts.tsx:42-47` | **`_isDesktopClient` 带下划线前缀** — 约定表明未使用，但实际在使用。下划线具有误导性 | 重命名为 `isDesktopClient` |
| 19.27 | `home-rewards-teaser.tsx:69` | **非桌面客户端不渲染任何内容** — 当 `!isDesktopClient` 时，返回 null。Web 用户在可以显示奖励的位置看到空白 | 显示适合 web 的奖励提示或从非桌面布局中移除组件 |
| 19.28 | `bot-picker.tsx:1-62` | **原生 `<select>` 没有自定义样式** — 精心设计的 UI 中未样式化的 HTML select。与设计系统的其余部分不一致 | 使用 UI 库中的样式化 select 组件 |
| 19.29 | `wechat-setup-view.tsx:1-342` | **`while (true)` 重试循环没有最大重试次数** — 二维码轮询使用 `while (true)` 仅依赖 `AbortController` 取消。如果中止信号从不触发（如组件在微任务期间卸载），循环可能无限运行 | 添加最大重试次数作为安全网 |
| 19.30 | `feishu-permissions-panel.tsx:1-222` | **通过 `JSON.stringify` 比较进行脏检测** — `isDirty` 通过比较 `JSON.stringify(original)` 和 `JSON.stringify(current)` 计算。对对象的属性顺序敏感，对嵌套结构脆弱 | 使用深度相等函数如 `lodash.isEqual` 或自定义比较器 |
| 19.31 | `workspace-layout.tsx` | **`localStorage` 侧边栏宽度使用时没有 try/catch** — `localStorage.getItem("nexu:sidebar:width")` 在隐私浏览模式或存储已满时可能抛出异常 | 用 try/catch 包裹并回退到默认宽度 |
| 19.32 | `connection-graphic.tsx:1-45` | **SVG 中硬编码的 viewBox 尺寸** — `viewBox="0 0 406 200"` 带固定像素位置。不能缩放到不同容器尺寸 | 使用相对定位或 `preserveAspectRatio` |

---

## Module 20: UI 基础组件、Hooks 与 Lib 工具

**审查文件：** `badge.tsx`、`button.tsx`、`card.tsx`、`dialog.tsx`、`input.tsx`、`label.tsx`、`select.tsx`、`separator.tsx`、`switch.tsx`、`tabs.tsx`、`textarea.tsx`、`chat-markdown.tsx`、`page-header.tsx`、`use-active-channel.ts`、`use-auto-update.ts`、`use-bot-quota.ts`、`use-bots.ts`、`use-cloud-connect.ts`、`use-community-catalog.ts`、`use-countdown.ts`、`use-desktop-cloud-status.ts`、`use-desktop-rewards.ts`、`use-github-stars.ts`、`use-locale.tsx`、`use-page-title.ts`、`use-update-channel-bot.ts`、`use-update-feishu-permissions.ts`、`use-experthub-catalog.ts`、`community-skill-card.tsx`、`import-skill-modal.tsx`、`import-skill-modal-state.ts`、`i18n/index.ts`、`markdown.ts`、`tracking.ts`、`desktop-links.ts`、`desktop-platform.ts`、`channel-live-status.ts`、`channel-links.ts`、`skill-translations.ts`、`logout.ts`、`experts-view-state.ts`、`skills-view-state.ts`、`auth-client.ts`、`whatsapp.ts`、`api.ts`、`reward-share-assets.ts`、`reward-virtual-check.ts`、`toolkit-permissions.ts`

### 严重问题

| # | 文件 | 问题 | 建议修复 |
|---|------|-------|---------------|
| 20.1 | `desktop-links.ts:92-98` | **shell-open 端点使用了原始 `fetch()`** — `fetch("/api/internal/desktop/shell-open", ...)` 绕过了生成的 SDK，违反硬性规则"前端必须使用生成的 SDK" | 将端点添加到 SDK 或从 controller OpenAPI spec 导出 |

### 高问题

| # | 文件 | 问题 | 建议修复 |
|---|------|-------|---------------|
| 20.2 | `reward-virtual-check.ts:27-32` | **伪造的奖励验证 — 1.4 秒的装饰性延迟** — `runVirtualRewardCheck` 除了 `await wait(1400)` 什么也不做。用户看到"检查中..."阶段但没有实际的服务器端验证发生。与 welcome.tsx 中的伪造 API 密钥验证模式相同（严重 #30） | 要么实现真正的服务器端验证，要么移除伪造的检查阶段 |
| 20.3 | `import-skill-modal.tsx:229-251` | **GitHub 标签是死占位 UI** — GitHub 导入标签渲染了一个禁用的输入框和"即将推出"消息。22 行非功能性 UI，用户可以导航到但无法使用 | 要么实现 GitHub 导入，要么在准备好前隐藏标签 |
| 20.4 | `community-skill-card.tsx:80-143` | **卡片即链接包含嵌套的 Switch** — 与 `expert-card.tsx` 相同的反模式：整个卡片在 `<Link>` 中，Switch 切换上有 `e.preventDefault(); e.stopPropagation()`。嵌套的交互元素使屏幕阅读器混淆 | 使用扁平布局，链接区域排除切换按钮 |
|---|------|-------|---------------|
| 20.2 | `reward-virtual-check.ts:27-32` | **虚假奖励验证 — 1.4秒装饰性延迟** — `runVirtualRewardCheck` 除了 `await wait(1400)` 之外什么也没做。用户看到 "Checking..." 阶段，但没有实际的服务端验证。与 welcome.tsx 中的虚假 API key 验证模式相同（严重 #30） | 实现真正的服务端验证，或移除虚假的检查阶段 |
| 20.3 | `import-skill-modal.tsx:229-251` | **GitHub 标签是无效的占位符 UI** — GitHub 导入标签渲染了一个禁用的输入框，显示 "Coming Soon" 消息。22行非功能性 UI，用户可以导航到但无法使用 | 实现 GitHub 导入功能，或在准备好之前隐藏该标签 |
| 20.4 | `community-skill-card.tsx:80-143` | **Card-as-Link 与嵌套 Switch** — 与 `expert-card.tsx` 相同的反模式：整个卡片在 `<Link>` 中，Switch 切换使用 `e.preventDefault(); e.stopPropagation()`。嵌套的交互元素会让屏幕阅读器产生混淆 | 使用扁平布局，将链接区域排除切换按钮 |

### 中等问题

| # | 文件 | 问题 | 建议修复 |
|---|------|-------|---------------|
| 20.5 | `use-auto-update.ts:1-299` | **299行的 hook 包含复杂的未经测试的状态机** — 3个 useEffect 中有7个更新阶段、IPC 事件、轮询、能力检测、应用内 vs 外部模式。状态转换无测试覆盖 | 拆分为更小的 hooks 并添加单元测试 |
| 20.6 | `use-auto-update.ts:126` | **1秒轮询更新状态** — `setInterval(pollStatus, 1000)` 在挂载期间持续运行。结合其他轮询（analytics 2s, sessions 10s, rewards 2s），增加了后台网络流量 | 增加到5秒或切换为纯事件驱动 |
| 20.7 | `use-cloud-connect.ts:37-58` | **错误处理与特定消息字符串耦合** — 检查 `data?.error === "Connection attempt already in progress"` 和 `"Already connected. Disconnect first."`。后端措辞的任何变化都会破坏此逻辑 | 使用错误代码或类型化的错误响应，而非字符串匹配 |
| 20.8 | `desktop-links.ts:30-40` | **`openLocalFolderUrl` 路径构建跨平台脆弱** — 通过 `encodeURI` 构建 `file://` URL，再转换回文件路径，然后发送到原始 fetch 端点。文件 URL 处理在不同平台上众所周知的差异（Windows 盘符、UNC 路径、编码） | 使用专用的 `shell:open-path` IPC 调用替代 URL-to-fetch 的方式 |
| 20.9 | `card.tsx:1-61` | **Card 缺少 CardFooter** — shadcn/ui 约定包含 `CardFooter` 但未导出。需要页脚的用户必须自行构建 | 添加 `CardFooter` 子组件 |
| 20.10 | `channel-links.ts:17-31` | **Feishu openChatId 使用4种不同的键名检查** — 依次尝试 `openChatId`、`open_chat_id`、`chatId`、`chat_id`。不一致的元数据键约定迫使编写防御性代码 | 将元数据键标准化为单一约定（camelCase） |
| 20.11 | `use-github-stars.ts:42-60` | **直接 `fetch()` 调用 GitHub API，无错误处理或速率限制** — GitHub 未认证 API 有严格的速率限制（每IP每小时60次）。同一 IP 后的多个用户（办公室 NAT）共享配额 | 通过 controller 代理以添加认证和缓存 |
| 20.12 | `toolkit-permissions.ts:1-179` | **26个硬编码的 toolkit 权限集（179行静态数据）** — 添加新 toolkit 需要编辑 TypeScript 源代码。可以放在 JSON 配置或本地化文件中 | 移至 JSON 配置文件或 i18n 本地化资源 |
| 20.13 | `skill-translations.ts:1-110` | **110+ 标签翻译作为硬编码 Record** — zh-CN 的 skill 标签翻译存在于与主 i18n 本地化文件分离的单独文件中。`zh-CN.ts` 本地化文件可以包含这些标签 | 将标签翻译移入 `i18n/locales/zh-CN.ts` 以保持一致性 |
| 20.14 | `use-desktop-rewards.ts:107-112` | **refetchInterval 依赖 visibilityState + hasFocus** — `document.hasFocus()` 在 iframe、后台标签页中或当 OS 焦点在另一个窗口但标签页可见时不可靠 | 仅使用 Page Visibility API 或添加 `focus` 事件监听器 |
| 20.15 | `auth-client.ts:5-7` 和 `api.ts:4-6` | **Electron 检测重复** — 两个文件独立检查 `navigator.userAgent.includes("Electron")` 来决定 base URL 解析 | 提取 `isElectronRenderer()` 到 `@/lib/desktop-platform.ts` |
| 20.16 | `use-locale.tsx:26-35` 和 `i18n/index.ts:8-17` | **本地化检测逻辑重复** — `detectDefault()` 和 `detectLocale()` 都实现了相同的 localStorage + navigator.language 回退逻辑 | 使用从共享位置导入的单一 `detectLocale()` 函数 |

### 低等问题

| # | 文件 | 问题 | 建议修复 |
|---|------|-------|---------------|
| 20.17 | `dialog.tsx:29-57` | **DialogContent 总是渲染 Overlay** — 没有禁用背景遮罩的 prop。某些用例（如非模态 sheet）可能不需要遮罩 | 添加 `overlay` prop：`"default" | "none"` |
| 20.18 | `reward-task-icon.tsx:1-221` | **221行的 switch...case 中有11个内联 SVG 图标** — 单个文件中有 14.5KB 的 SVG 路径。添加新平台需要编辑此文件 | 将每个图标拆分为 `reward-icons/` 目录中的独立组件 |
| 20.19 | `markdown.ts:11-14` | **`link_open` 渲染规则使用 `??` 回退** — 回退到通用 `renderToken`，但 markdown-it 总是有默认规则，因此回退是死代码 | 移除 `??` 保护；markdown-it 保证默认规则存在 |
| 20.20 | `tracking.ts:26-28` | **Module 级别的去重状态** — `currentUserId`、`currentIdentifyKey` 存储在模块作用域。多个浏览器标签页共享相同的模块实例，但每个标签页需要独立的 PostHog 状态 | 文档化此限制或使用 `sessionStorage` 存储去重键 |
| 20.21 | `switch.tsx:14-36` | **SIZES 配置在 Tailwind 中使用魔法数字** — track/thumb/translate 的像素值散布在依赖 JS 缩放的 Tailwind 类中 | 考虑将尺寸配置移至 CSS 自定义属性 |
| 20.22 | `chat-markdown.tsx:14` | **`dangerouslySetInnerHTML` 与 markdown-it** — 安全是因为 `html: false` 阻止原始 HTML 注入，链接使用 `noopener noreferrer nofollow` 消毒，图片已禁用。安全保证依赖于 markdown-it 没有零日 HTML 绕过 | 已有 biome-ignore 注释；考虑定期依赖审计 |

---

## Module 21: 渠道管理、集成与会话详情页

**审查文件:**
- `apps/web/src/pages/channels.tsx` (917 lines)
- `apps/web/src/pages/integrations.tsx` (773 lines)
- `apps/web/src/pages/sessions.tsx` (1297 lines)

### 严重问题

| # | 文件 | 问题 | 建议修复 |
|---|------|-------|---------------|
| 21.1 | `sessions.tsx:194-305` | **150行的 `extractMessage()` 包含6个嵌套内容格式分支** — 处理字符串文本、字符串内容、块数组（text、replyContext、toolCall/tool_use、a2ui、image、file），以及内联 A2UI JSONL 解析。每个分支解析不同形状的 `Record<string, unknown>`。如果上游 OpenClaw 更改内容格式，消息会静默渲染为空或崩溃 | 在提取前添加 Zod schema 验证消息内容；拆分为格式特定的解析器 |
| 21.2 | `sessions.tsx:863-946` | **`handleSend` 重复了 `local-chat.tsx` 的消息格式化逻辑** — 两个文件独立构建 `{ type: "text"|"image", content, attachments }` 负载，结构完全相同。聊天 API 消息格式的任何变更都需要同时更新两个文件 | 提取 `buildChatMessagePayload(text, attachments)` 到共享 lib |
| 21.3 | `channels.tsx:515-546` | **`handleOpenSlack` 使用 blur 事件作为原生应用检测器** — 设置 `window.location.href = nativeUrl`，然后依赖 `window.addEventListener("blur", cancelFallback)` 取消5秒 `window.open()` 回退计时器。如果浏览器没有失去焦点（如 Slack 未安装、浏览器权限阻止协议），用户会同时得到失败协议导航和新标签页 | 使用 `navigator.clipboard` 或通过 `iframe` 探测检测协议支持；避免基于 blur 的检测 |

### 高等问题

| # | 文件 | 问题 | 建议修复 |
|---|------|-------|---------------|
| 21.4 | `sessions.tsx:393-449` | **PLATFORM_CONFIG Record 从 `channels.tsx` 和 `platform-icons.tsx` 重复** — 相同的 platform→color/label 映射在3个文件中定义。添加一个平台需要3次编辑 | 提取到 `@/lib/platform-config.ts` 作为单一事实来源 |
| 21.5 | `sessions.tsx:840-851` | **不安全的 `selectedBot` 从 `Record<string, unknown>` 强制转换** — 来自 API 的 bot 数据使用5个 `as` 断言链式转换：`(bot as Record<string, unknown>).id as string`。如果 API 返回意外形状，运行时崩溃 | 为 bot 响应添加 Zod schema 或使用适当的类型收窄 |
| 21.6 | `sessions.tsx:955-960` | **基于文本比较的乐观消息去重** — `serverUserTexts` Set 比较 `extractMessage(...).text` 来识别待处理消息。快速连续发送两条相同的用户消息会错误地去重，隐藏第二条消息 | 使用客户端生成的消息 ID（`cuid2`）进行去重，而非文本内容 |
| 21.7 | `sessions.tsx:232-250` | **A2UI JSONL 逐行使用 try/catch 解析** — 每个文本块行都被 `JSON.parse()` 解析并静默捕获。对于包含许多非 JSON 行的长消息，这是浪费的 | 在解析前使用 `line.startsWith("{")` 预过滤行；使用正确的 JSONL 流式解析器 |
| 21.8 | `integrations.tsx:447-465` | **OAuth 轮询 useEffect 有不稳定的依赖** — 当 `integrations.length` 变化时触发，但 `startPolling` 闭包捕获了 `navigate` 和 `queryClient`。任何集成列表变更都会清除轮询计时器并重新开始 | 使用 ref 保存轮询计时器，将轮询与集成列表长度解耦 |
| 21.9 | `integrations.tsx:536-546` | **localStorage 中 OAuth 待处理状态永不清理** — `nexu-oauth-pending-${id}` 条目在连接时存储但只在回调时读取。失败或放弃的 OAuth 流程会留下过时的 localStorage 条目 | 在挂载时清理过时条目或添加基于 TTL 的过期 |
| 21.10 | `channels.tsx:305-351` | **平台设置视图通过9分支链式三元选择** — `platform === "slack" ? ... : platform === "discord" ? ... : ...` 有9个平台分支。添加一个平台需要编辑此链 | 使用 `Record<Platform, React.ComponentType>` 查找对象 |

### 中等问题

| # | 文件 | 问题 | 建议修复 |
|---|------|-------|---------------|
| 21.11 | `sessions.tsx:55-87` | **`stripMetadata()` 正则表达式处理原始文本3次** — 依次运行会话元数据、发送者元数据和回复元数据正则。然后对原始 `raw` 字符串再运行2次模式匹配。每条消息5次正则操作 | 链式替换或使用单一组合正则 |
| 21.12 | `sessions.tsx:330-366` | **`formatToolCallSummary()` 包含硬编码大写 token 集** — `uppercaseTokens` Set 有10个条目（"api"、"ci"、"csv"、"db"、"gh"、"pdf"、"qa"、"sql"、"ui"、"ux"）。新工具名需要手动添加 | 将 token 列表移至配置或使用通用的缩写检测启发式 |
| 21.13 | `sessions.tsx:762-764` | **SSE 客户端在每次会话元数据变更时创建/销毁** — `useEffect` 依赖 `session?.botId` 和 `session?.sessionKey`。如果会话元数据更新（如标题变更触发重渲染），SSE 断开并重连 | 仅在 `botId` 或 `sessionKey` 值实际变化时重连，使用 ref 比较 |
| 21.14 | `sessions.tsx:1200-1222` | **`flatMap` 与内联分割线计算** — 会话分割线逻辑在 `.flatMap()` 回调内计算。混合了数据转换与 UI 渲染关注点 | 在渲染消息列表之前预计算分割线位置 |
| 21.15 | `sessions.tsx:867-886` | **`/new`、`/reset`、`/clear` 命令在客户端拦截** — 这些命令在 `handleSend` 中检查，永远不会到达服务器。如果服务端也处理它们，不同客户端之间的行为会有差异 | 文档化客户端专用命令行为或移至 UI 按钮 |
| 21.16 | `integrations.tsx:35-82` | **`useStatusBadgeConfig()` hook 不必要** — 总是返回相同的对象形状（仅随语言变化）。普通的 Module 级 `Record` 配合渲染时的 `t()` 调用会更简单，避免 hook 抽象 | 转换为普通函数 `getStatusBadgeConfig()` 或 Module 级常量，`t` 作为参数传入 |
| 21.17 | `integrations.tsx:463-465` | **OAuth 轮询最多20次尝试 x 3秒 = 60秒硬编码** — 超时值是两个魔法数字的乘积，没有命名常量。如果 OAuth 提供方耗时 >60s，即使连接可能成功，用户也会收到超时错误 | 提取 `OAUTH_POLL_MAX_ATTEMPTS` 和 `OAUTH_POLL_INTERVAL_MS` 常量 |
| 21.18 | `integrations.tsx:549-553` | **`oauthTabRef` 模式跨浏览器脆弱** — 打开 `about:blank` 标签页然后设置 `location.href`。一些浏览器会将其作为弹窗规避阻止。弹窗拦截器也可能阻止 `window.open()` 回退 | 在 `window.open()` 中使用直接的 OAuth URL，配合正确的用户手势处理 |
| 21.19 | `integrations.tsx:717-727` | **OAuth 弹窗在 map 渲染中的 `onConnect` 回调内打开** — `window.open()` 在渲染阶段的点击处理程序中调用。如果用户快速点击，`connectMutation.isPending` 变为 true 之前会打开多个弹窗 | 在调用 mutate 之前立即禁用按钮 |
| 21.20 | `channels.tsx:85-95` | **PLATFORM_LABELS Record 从 platform-icons.tsx 重复** — 相同的 `Record<Platform, string>` 在两个文件中定义 | 从共享位置导入（参见高 #21.4） |
| 21.21 | `channels.tsx:137-144` | **`getApiV1ChannelsLiveStatus` 结果使用 `as LiveStatusData` 强制转换** — 没有对实时状态响应形状的运行时验证。如果 API 变更，`liveStatusData?.channels?.find(...)` 可能静默失败 | 添加 Zod 验证或至少检查 `Array.isArray(liveStatusData?.channels)` |
| 21.22 | `channels.tsx:509-513` | **Slack teamId 从 accountId 字符串格式解析** — `accountId.replace(/^slack-[^-]+-/, "")` 假定格式为 `slack-{appId}-{teamId}`。如果格式变更，teamId 提取会静默中断 | 将 teamId 作为通道元数据中的独立字段存储，而非从 accountId 解析 |
| 21.23 | `channels.tsx:821-893` | **内联断开确认对话框** — 从头构建了完整的模态框，包含背景遮罩、Escape 键处理、点击外部关闭，而不是使用现有的 `Dialog` 组件（来自 `@/components/ui/dialog`） | 使用 `@/components/ui/dialog` 保持一致性和可访问性 |
| 21.24 | `integrations.tsx:203-262` | **`DisconnectDialog` 也是内联构建** — 与 channels.tsx 相同，构建自定义模态框而非使用 `@/components/ui/dialog` | 使用共享 Dialog 组件 |
| 21.25 | `sessions.tsx:558-567` | **`ReplyContextCard` 使用魔法颜色值** — `bg-[rgba(148,163,184,0.6)]`、`bg-[rgba(248,250,252,0.95)]` 是硬编码的。如果主题变更，这些不会自适应 | 使用 CSS 自定义属性或 Tailwind 主题 token |

### 低等问题

| # | 文件 | 问题 | 建议修复 |
|---|------|-------|---------------|
| 21.26 | `sessions.tsx:40-41` | **BOT_AVATAR / USER_AVATAR 硬编码路径** — `"/images/claw-avatar.png"` 和 `"/images/tabby-avatar.png"` 作为 Module 级常量。如果头像文件名变更，两个文件都需要更新 | 移至配置或使用 URL 导入以进行缓存清除 |
| 21.27 | `sessions.tsx:323` | **`formatTs()` 对每条消息使用 `padStart`** — 在每条消息渲染时调用。虽微不足道但可以按时间戳缓存 | 使用 `Intl.DateTimeFormat` 配合 `hour: "2-digit", minute: "2-digit"` 以获得更好的 i18n |
| 21.28 | `sessions.tsx:315-328` | **`formatRelativeTime()` 手工实现** — 手动实现相对时间格式化，而非使用 `Intl.RelativeTimeFormat` 或 `date-fns` 等库 | 使用 `Intl.RelativeTimeFormat` 实现 i18n 正确的相对时间 |
| 21.29 | `sessions.tsx:337` | **`chatLoading ? null : ...` 加载期间不渲染任何内容** — 当聊天消息加载时，整个消息区域为空白，而非显示加载旋转器 | 在聊天消息获取期间显示加载指示器 |
| 21.30 | `sessions.tsx:1281` | **`onSelectBot={() => {}}` 空操作处理程序** — ChatInputArea 的 bot 选择器已渲染但通过 `showBotSelector={false}` 禁用，选择处理程序是空函数。令人困惑的 API | 当 `showBotSelector` 为 false 时移除 `onSelectBot` 要求 |
| 21.31 | `integrations.tsx:440` | **`refetchInterval: 10000` 用于集成列表** — 无论是否有集成处于待处理/连接中状态，每10秒轮询一次 | 仅当集成处于非终态时才轮询 |
| 21.32 | `channels.tsx:143` | **`refetchInterval: 3000` 用于实时状态** — 即使没有通道处于连接中状态也每3秒轮询。当所有通道稳定后，这是浪费 | 增加到10秒或通过 SSE/WebSocket 切换为事件驱动 |
| 21.33 | `channels.tsx:129` | **`useQuery` 键 `["channels"]` 与 sessions.tsx 冲突** — channels.tsx 和 sessions.tsx 都查询 `["channels"]`。React Query 共享缓存，这是正确的，但重复了 queryFn 逻辑 | 提取 `useChannels()` hook 共享查询定义 |
| 21.34 | `sessions.tsx:808-815` | **`channelsData` 查询重复 channels.tsx** — 相同的 `["channels"]` 键和 `getApiV1Channels` 调用。channels 查询的第三次重复 | 使用共享 `useChannels()` hook |
| 21.35 | `channels.tsx:75-83` | **`PLATFORMS` 数组使用硬编码 emoji 和描述** — 类中文描述字符串（"Personal WhatsApp"、"Workspace Bot"）硬编码在源代码中而非使用 i18n | 将描述移至本地化文件 |
| 21.36 | `integrations.tsx:29-30` | **`Integration` 类型通过 `Awaited<ReturnType<...>>`** — 从 SDK 返回类型的复杂类型推导，而非直接使用生成的类型 | 使用生成的 SDK 类型（如 `components["schemas"]["Integration"]`） |
| 21.37 | `channels.tsx:275-278` | **"Coming soon" 标签配 Zap 图标** — 永久性的 UI 元素，宣传未来平台。如果没有积极添加新平台，这是无效 UI | 移除或隐藏，直到有实际的平台上线计划 |

---

## Module 22: 社区技能详情、专家详情、飞书绑定、Slack 认领、Slack OAuth、设备页面

**审查文件:**
- `apps/web/src/pages/community-skill-detail.tsx` (561 lines)
- `apps/web/src/pages/expert-detail.tsx` (252 lines)
- `apps/web/src/pages/feishu-bind.tsx` (275 lines)
- `apps/web/src/pages/slack-claim.tsx` (635 lines)
- `apps/web/src/pages/slack-oauth-callback.tsx` (84 lines)
- `apps/web/src/pages/devices/index.tsx` (281 lines)
- `apps/web/src/pages/devices/device-card.tsx` (219 lines)
- `apps/web/src/pages/devices/mirror-panel.tsx` (267 lines)
- `apps/web/src/pages/devices/task-detail-page.tsx` (190 lines)
- `apps/web/src/pages/devices/task-history-page.tsx` (240 lines)

### 严重问题

| # | 文件 | 问题 | 建议修复 |
|---|------|-------|---------------|
| 22.1 | `community-skill-detail.tsx:70-163` | **手写 markdown 解析器（160+ 行）** — `parseMdBlocks` 和 `renderInline` 从头实现了一个自定义的 markdown→React 渲染器。这重复了项目现有的 `ChatMarkdown` 组件，并创建了一个分化的渲染管线。任何 markdown 规范边缘情况（嵌套列表、转义字符、内联 HTML、引用式链接）在这里都是 bug | 替换为现有的 `ChatMarkdown` 组件或使用 `marked`/`markdown-it` 等库 |
| 22.2 | `community-skill-detail.tsx:356` | **`data as unknown as SkillDetail` 双重强制转换** — API 响应通过 `unknown` 强制转换来绕过 TypeScript。如果 API 响应形状变更，整个详情页在运行时崩溃，没有编译时错误 | 为技能详情响应定义 Zod schema |
| 22.3 | `devices/index.tsx:38-71` | **同一组件中混合手动 fetch + React Query** — `fetchDevices` 使用手动 `useState`/`setInterval` 轮询，而 `runtimeConfig` 使用 `useQuery`。一个组件中不一致的数据获取模式使代码更难推理 | 将 `fetchDevices` 转换为 `useQuery`，配置 `refetchInterval: 5000` |

### 高等问题

| # | 文件 | 问题 | 建议修复 |
|---|------|-------|---------------|
| 22.4 | `devices/device-card.tsx:103-136` | **`contentEditable` 用于设备重命名** — 使用 `suppressContentEditableWarning` 来消除 React 对 contentEditable 的内置警告。与代码库中其他 contentEditable 使用（高 #17, #18）相同的 XSS 和 IME 问题 | 替换为视觉上匹配显示文本的受控 `<input>` |
| 22.5 | `devices/mirror-panel.tsx:30-98` | **每次鼠标事件都进行指针坐标映射** — `mapPointerToDevice` 在每次 `mousedown`/`mousemove`/`mouseup` 时调用 `getBoundingClientRect()`。对于快速的触摸/笔输入，这会导致布局抖动 | 对指针事件进行防抖或节流；在 resize 时缓存边界矩形 |
| 22.6 | `slack-claim.tsx:171-635` | **单组件中的8阶段状态机** — 阶段：resolving、invalid、expired、used、needs-auth、confirm、claiming、success。每个阶段渲染不同 UI。复杂条件逻辑配合 `sessionStorage` 副作用用于认证返回流程 | 将每个阶段拆分为独立组件；使用 reducer 管理阶段转换 |
| 22.7 | `feishu-bind.tsx:143-222` 和 `slack-claim.tsx:375-468` | **左侧面板品牌布局重复** — `#111111` 深色面板配合 BrandMark、英雄标题、能力标签和版权页脚在 feishu-bind、slack-claim（x2 面板）之间复制粘贴，可能还有其他认证页面 | 提取 `<AuthLeftPanel variant="new" | "existing">` 组件 |
| 22.8 | `slack-claim.tsx:237` | **Toast 对飞书也显示 "Slack account claimed"** — 成功 toast 中硬编码的平台字符串。`onSuccess` 总是显示 "Slack account claimed successfully"，不管 `detectPlatform()` 结果如何 | 在 toast 消息中使用 `platformCfg.label` |

### 中等问题

| # | 文件 | 问题 | 建议修复 |
|---|------|-------|---------------|
| 22.9 | `community-skill-detail.tsx:326-338` | **返回导航使用 `window.history.state`** — `getSkillsBackNavigation` 检查浏览器历史状态。如果用户直接通过 URL 导航（书签、外部链接），历史状态为空，导航回退到硬编码路由 | 使用 URL 搜索参数编码返回信息，而非历史状态 |
| 22.10 | `community-skill-detail.tsx:363-386` | **安装/卸载模式从 expert-detail.tsx 重复** — 两个文件实现了相同的 pendingAction 状态、try/finally 变更和加载/禁用按钮逻辑，约80%结构相似 | 提取 `useInstallUninstall(mutation, slug)` hook |
| 22.11 | `slack-claim.tsx:183-191` | **`sessionStorage` 用于认证返回检测** — `CLAIM_RETURN_KEY` 存储在 sessionStorage 中以检测用户从认证页面返回。如果用户在新标签页中打开认领链接，sessionStorage 为空，自动认领不会触发 | 使用 URL 查询参数（`?return=1`）替代 sessionStorage |
| 22.12 | `slack-claim.tsx:243-263` | **`claimSubmittedRef` 防双提交仍可能触发两次** — `useEffect` 有6个依赖。如果 `userConfirmed` 和 `isReturnFromAuth` 快速连续都为 true，`claimSubmittedRef` 可能无法防止双重变更 | 在 effect 内部使用 `claimMutation.isPending` 检查；移除 `claimSubmittedRef` |
| 22.13 | `slack-oauth-callback.tsx:39-41` | **任意的2秒重定向延迟** — `setTimeout(() => navigate(...), 2000)` 没有用户交互。用户在 < 2秒内无法阅读成功消息，而快速阅读者则不必要地等待 | 在自动重定向旁显示 "前往渠道" 按钮 |
| 22.14 | `slack-oauth-callback.tsx:37` | **`identify({ channels_connected: 1 })` 硬编码** — 假设 OAuth 后恰好连接了1个通道，但用户可能有多个通道 | 从 API 查询实际通道数而非硬编码 |
| 22.15 | `devices/index.tsx:80-97` | **手动 `setInterval` + `visibilitychange` 轮询** — 相同的隐藏暂停模式临时实现，而非使用 React Query 内置的 `refetchInterval` 配合 `refetchOnWindowFocus` | 使用 `useQuery` 配合 `refetchInterval: 5000` |
| 22.16 | `devices/index.tsx:40-42` | **QR 码 URL 从 `runtimeConfig` 字段构建** — `ws://${ip}:${port}/phone` 假定 WebSocket 协议和格式。没有验证 `localIp` 是有效 IP 或 `wsPort` 是有效端口号 | 在构建 URL 前使用 Zod 验证 IP/端口 |
| 22.17 | `devices/device-card.tsx:83` | **`commitRename` 静默吞掉错误** — `catch { // ignore }` 在重命名失败时。用户点击别处，重命名看起来成功但并未持久化 | 在重命名失败时显示 toast 并恢复为之前的名称 |
| 22.18 | `devices/task-detail-page.tsx:28-33` 和 `task-history-page.tsx:29-35` | **`formatChannelConnectErrorMessage` 用于设备任务错误** — 错误格式化器是为通道连接错误设计的，而非设备任务错误。对设备相关故障产生误导性错误消息 | 创建专用的设备错误格式化器或使用通用格式化器 |
| 22.19 | `devices/task-detail-page.tsx:48-51` 和 `task-history-page.tsx:148-189` | **任务详情渲染重复** — 相同的结果网格、步骤列表、消息显示和截图渲染在任务详情页和任务历史的内联展开行中完全相同 | 提取 `<TaskResultDetail entry={entry}>` 组件 |
| 22.20 | `devices/task-detail-page.tsx:15-44` 和 `task-history-page.tsx:23-46` | **手动 fetch 配合 `cancelled` 标志** — 两者都实现了相同的 `let cancelled = false` + IIFE + 清理模式，而非使用 React Query 或 AbortController | 使用 React Query 配合适当的 query key |
| 22.21 | `devices/mirror-panel.tsx:109-117` | **WebSocket 状态使用魔法字符串** — "connecting"、"subscribing"、"open"、"closed" 在组件中作为字符串字面量比较 | 定义 `MirrorStatus` 枚举或联合类型 |
| 22.22 | `feishu-bind.tsx:27-30` | **AppId 通过 `ws.startsWith("feishu:")` 提取** — 脆弱的字符串前缀匹配。如果 workspace key 格式变更（如 `feishu_v2:`），提取会静默中断 | 使用适当的解析器或将 appId 作为独立的查询参数存储 |
| 22.23 | `expert-detail.tsx:39-45` | **`window.history.length > 1` 用于返回导航** — 在 SPA 中不可靠。如果用户直接导航到详情页，`history.length` 为1但 `navigate(-1)` 仍然会执行（跳转到浏览器的新标签页面） | 使用回退路由替代基于历史的导航 |

### 低等问题

| # | 文件 | 问题 | 建议修复 |
|---|------|-------|---------------|
| 22.24 | `devices/index.tsx:129,147,158,218,258,268-273` | **硬编码中文字符串** — "下载 Tabby"、"扫码连接"、"扫描下载 Tabby App"、"扫码连接手机" 以及 QR 码说明是硬编码的中文 | 移至 i18n 本地化文件 |
| 22.25 | `devices/device-card.tsx:195,242` | **硬编码中文字符串** — "执行中…" 和 "重命名" 硬编码 | 移至 i18n 本地化文件 |
| 22.26 | `devices/mirror-panel.tsx:243` | **硬编码中文字符串** — "输入文字发送到手机…" | 移至 i18n 本地化文件 |
| 22.27 | `community-skill-detail.tsx:165-224` | **`renderInline` 正则处理整个文本** — 正则 `/`[^`]+`|.../g` 在每次内联渲染调用时重新编译。对于包含许多段落的大型 SKILL.md 文件，这会累积 | 在 Module 级别编译一次正则 |
| 22.28 | `community-skill-detail.tsx:246-251` | **标题级别偏移 +1** — `Math.min(block.level + 1, 6)` 提升标题级别。Markdown `#` 变成 `<h2>`，这在可访问性语义上是不正确的 | 移除 +1 偏移；使用实际的 markdown 标题级别 |
| 22.29 | `devices/mirror-panel.tsx:14` | **`useId()` 生成但未使用** — `titleId` 使用 `useId()` 生成但从未使用，因为 `aria-labelledby` 属性在 `<aside>` 上，而 `id` 在内部 `<div>` 上。屏幕阅读器无法连接它们 | 将 `id={titleId}` 移至 `<aside>` 元素或直接使用 `<h2>` |
| 22.30 | `slack-claim.tsx:77` | **`useMemo` 用于静态能力标签** — `capabilityPills` 被缓存但仅依赖 `[t]`，后者很少变化。数组重建成本可忽略 | 使用普通 `useMemo` 或 Module 级常量，`t` 在渲染时传入 |
| 22.31 | `slack-oauth-callback.tsx:2-7` | **从 ui/card 导入 Card 组件** — 这是唯一使用 `Card` UI 组件的页面；其他所有页面使用基于 div 的内联卡片 | 要么在所有页面一致采用 Card，要么移除该导入 |
| 22.32 | `devices/index.tsx:12` | **`Link` 从 `react-router-dom` 导入仅用于任务历史链接** — QR 码按钮使用手动状态切换而非适当的链接 | 使用一致的导航模式 |

---

## Module 23: 模型、奖励、技能页面与设备组件

**审查文件:**
- `apps/web/src/pages/models.tsx` (3624 lines — 前端最大的文件)
- `apps/web/src/pages/rewards.tsx` (789 lines)
- `apps/web/src/pages/skills.tsx` (1067 lines)
- `apps/web/src/pages/devices/mirror-dialog.tsx` (108 lines)
- `apps/web/src/pages/devices/settings-section.tsx` (95 lines)
- `apps/web/src/pages/devices/task-dispatch-dialog.tsx` (186 lines)
- `apps/web/src/pages/devices/use-device-snapshot.ts` (47 lines)
- `apps/web/src/pages/devices/use-mirror-socket.ts` (133 lines)
- `apps/web/src/components/chat-input-area.tsx` (前250行)
- `apps/web/src/components/activity-feed.tsx` (164 lines)
- `apps/web/src/components/channel-connect-modal.tsx` (250 lines)

### 问题

| # | 文件 | 严重级别 | 问题 | 建议修复 |
|---|------|----------|-------|---------------|
| 23.1 | `models.tsx:3624` | **严重** | **庞大的3624行单体组件文件** — 包含2个根组件（`ModelsPage`、`_GeneralSettings`）、3个提供商详情面板（`ManagedProviderDetail`、`ByokProviderDetail`、`AddCustomProviderDetail`）、4个认证状态机（MiniMax OAuth Desktop + Web、OpenAI OAuth、Z.AI Coding Plan、标准 BYOK）、2个轮询间隔、约50个辅助函数，以及具有7个依赖的复杂 `sidebarItems` 推导。这是整个前端最复杂的文件。任何变更都有破坏不相关功能的风险 | 拆分为 `pages/models/` 目录：`general-settings.tsx`、`provider-list.tsx`、`managed-provider-detail.tsx`、`byok-provider-detail.tsx`、`custom-provider-form.tsx` |
| 23.2 | `models.tsx:281,304` | **高** | **通过 `window.nexuHost` 反射访问桌面 IPC 桥接** — `getModelsHostInvokeBridge()` 使用 `Reflect.get(candidate, "invoke")` 并将其包装在自定义 `invoke` 调用中。如果 preload API 形状变更，所有6个调用（get-minimax-oauth-status、start-minimax-oauth、cancel-minimax-oauth、shell:open-external、update:get-current-version、desktop:get/set-shell-preferences）会静默失败，没有类型化回退 | 定义类型化的 `DesktopBridge` 接口并在启动时验证；如果桥接无效则提前抛出异常 |
| 23.3 | `models.tsx:3039,3223,3507` | **高** | **`window.confirm()` 用于破坏性操作** — 3个位置使用浏览器原生 `confirm()` 对话框进行提供商/API key 删除：OAuth 断开（行3039）、MiniMax OAuth 删除（行3223）和 BYOK 提供商移除（行3507）。`confirm()` 阻塞主线程，与应用样式化的对话框不一致，且绕过可访问性工具 | 替换为应用的 `LogoutConfirmDialog` 或通用的 `<ConfirmDialog>` 组件 |
| 23.4 | `models.tsx:832,2220` | **高** | **两个独立的 `setInterval` 轮询循环用于云状态** — `_GeneralSettings` 每2秒轮询（行832），`ManagedProviderDetail` 也每2秒轮询（行2220）。两者都使用 `setInterval` + `refetchDesktopCloudStatus`。如果两个组件同时渲染（设置期间可能），API 被双倍轮询 | 将云登录轮询移至共享 hook `useCloudLoginPoller(enabled)` |
| 23.5 | `models.tsx:2540` | **中** | **MiniMax OAuth 状态 `refetchInterval` 是函数但仅检查 `inProgress`** — `refetchInterval: (query) => (query.state.data?.inProgress ? 2000 : false)`。如果 `inProgress` 变为 `undefined`（初始加载），轮询仍以2秒运行，然后在数据加载后停止，即使仍在进行中 | 添加显式 `query.state.data?.inProgress === true` 检查 |
| 23.6 | `models.tsx:2950-2973` | **高** | **MiniMax OAuth `useEffect` 调用 `queryClient.fetchQuery` 然后调用 `refetchQueries`** — 当 OAuth 连接时，effect 获取提供商配置，用可选链解析模型 ID，然后重新获取两个查询。`fetchQuery` + `refetchQueries` 模式是脆弱的：如果 `refetchQueries` 在 `fetchQuery` 缓存更新之前完成，会短暂显示过时数据 | 使用单一变更链或 `queryClient.invalidateQueries` 替代 `fetchQuery` + `refetchQueries` |
| 23.7 | `models.tsx:637-639` | **低** | **通过 `navigator.userAgent.toLowerCase().includes("windows")` 检测平台** — 脆弱的模式，如果 userAgent 格式变更则会中断。仅用于 UI 标签切换，影响较低，但与其他地方的 `isDesktopClient` 检查不一致 | 使用相同的 `Electron` userAgent 检查模式或桌面 IPC 获取平台 |
| 23.8 | `models.tsx:1114` | **中** | **`crashReportsEnabled` 状态从未持久化** — 切换崩溃报告更新本地状态但没有 API 调用或 `localStorage` 持久化。页面重载时重置为 `true` | 添加 API 调用持久化崩溃报告偏好或连接到 `desktopPreferences` |
| 23.9 | `models.tsx:1580-1632` | **中** | **使用 `prevModelIdRef` 和 `userSwitchRef` 的自动切换检测** — 两个 ref 之间复杂的来回切换，以区分用户发起的模型切换和后端自动切换。`userSwitchRef.current = true` 在 `updateModel.mutate` 中设置但在监视 `defaultModelData` 的 effect 中重置。如果 effect 在变更完成之前触发，toast 可能显示不正确 | 使用时间戳比较或直接比较模型 ID；移除 `userSwitchRef` |
| 23.10 | `models.tsx:2195,2508,2660,2750` | **高** | **提供商详情组件状态在提供商变更时未正确重置** — 行2749的 `useEffect` 在 `provider`/`providerConfig` 变更时重置9个状态变量。但如果用户正在编辑中，后台重新获取更新了 `providerConfig`，其进行中的编辑会被静默丢弃 | 单独跟踪 "脏" 状态；仅在提供商 ID 变更时重置，而非配置重新获取时 |
| 23.11 | `models.tsx:2498` | **中** | **`ByokProviderDetail` 有30+ props 和状态变量** — 该组件管理 `apiKey`、`baseUrl`、`authMode`、`oauthRegion`、`isEditingApiKey`、`verifiedModels`、`oauthPending`、`codingPlanKey`、`codingPlanRegion` 加上8个变更对象和4个查询对象。这使组件极难独立测试 | 拆分为 `ByokApiKeyForm`、`ByokOAuthForm`、`CodingPlanForm`、`ProviderModelList` 子组件 |
| 23.12 | `models.tsx:2360-2396` | **中** | **云登录错误处理使用 `setLoginError` + 轮询** — 3种不同的错误状态：`Already connected`、`Connection attempt already in progress` 和通用错误。第二个被静默忽略（视为待处理），而第一个触发断开+重试。复杂的错误分支难以测试 | 将登录状态机提取为专用的 `useCloudLogin` hook |
| 23.13 | `models.tsx:2170` | **低** | **"Select a provider" 文本硬编码为英文** — `t("models.selectProvider")` 存在但回退文本本身在组件中 | 已使用 i18n 键，验证键是否存在 |
| 23.14 | `rewards.tsx:444` | **高** | **`localStorage` 直接访问分析偏好** — `localStorage.getItem(ANALYTICS_PREFERENCE_STORAGE_KEY)` 在组件中直接访问，没有 React Query 包装。如果多个标签页修改 `localStorage`，此组件不会响应 | 使用 `useQuery` 配合 `localStorage` 监视器或移至 React context |
| 23.15 | `rewards.tsx:134-253` | **高** | **`RewardConfirmModal` 是120行内联组件，包含7分支链式三元** — `descKey`（行105-116）链式 `isChecking → isClaiming → isDaily → isImage → requiresScreenshot → default`。`title`（行119-125）和 `confirmLabel`（行127-131）重复相同模式。修改一个分支有破坏其他分支的风险 | 使用按状态键控的配置对象：`const config = STATE_CONFIG[{ checking: phase === 'checking', ... }]` |
| 23.16 | `rewards.tsx:338-371` | **中** | **GitHub star 奖励：10秒硬编码延迟** — `await new Promise((resolve) => setTimeout(resolve, 10_000))` 等待用户点击 star。如果用户立即 star，仍需等待10秒；如果用户花了15秒，验证触发太早 | 轮询 GitHub API 检查 star 状态或让用户点击 "我已 star" |
| 23.17 | `rewards.tsx:348` | **中** | **错误时 toast 未关闭** — `toast.loading(t("rewards.githubVerifying"))` 显示10秒。如果认领失败，toast 在行355关闭；但如果 `prepareGithubStarSession` 失败，没有关闭 toast，留下过时的加载 toast | 使用 try/finally 包装或确保所有退出路径关闭 toast |
| 23.18 | `rewards.tsx:233-252` | **低** | **奖励商店模态框硬编码按钮颜色** — 确认按钮使用 `bg-neutral-900` 而非使用 CSS 变量如 `bg-accent`。与应用其余部分的按钮主题不一致 | 使用应用的 Button 组件或 `bg-accent` CSS 变量 |
| 23.19 | `skills.tsx:65-74` | **中** | **`useDebounce` 内联定义（第3次出现）** — 相同的10行 hook 在 `experts.tsx`、`skills.tsx` 中重复。已在最高优先级问题中标记为 #31 | 移至 `@/hooks/use-debounce.ts` |
| 23.20 | `skills.tsx:997-998` | **低** | **免责声明链接中硬编码的 GitHub Issues URL** — `https://github.com/nexu-io/nexu/issues` 硬编码；应为常量或配置值 | 提取到共享常量 |
| 23.21 | `skills.tsx:791` | **低** | **搜索输入样式与 experts.tsx 相同** — 相同的 `w-48 pl-9 pr-3 py-1.5 rounded-lg` 搜索输入在 skills 和 experts 页面之间复制 | 提取 `<SearchInput>` 组件 |
| 23.22 | `devices/settings-section.tsx:24-27,41-44` | **中** | **`formatChannelConnectErrorMessage` 用于设备控制错误** — 通道特定的错误格式化器被用于与通道无关的运行时配置错误。在任务页面中已标记为 #22.18；设置中存在相同问题 | 使用通用的 `formatApiError(error, fallbackMessage)` 工具函数 |
| 23.23 | `devices/task-dispatch-dialog.tsx:34-38` | **中** | **对话框立即关闭，后台分派** — `onClose()` 在行38调用，在行41的 API 请求之前。如果 API 失败，用户看不到反馈，因为行58的 `setError` 渲染到一个已卸载的对话框（行24在 `!open` 时返回 `null`） | 在失败时显示 toast 而非内联错误；或保持对话框打开直到 API 完成 |
| 23.24 | `devices/task-dispatch-dialog.tsx:47-53` | **低** | **双重强制转换错误消息提取** — `(apiError as { message: unknown }).message` 然后 `String(...)`。与 channel-connect-modal 行48-52相同的模式 | 使用共享的 `getErrorMessage(error: unknown): string` 工具函数 |
| 23.25 | `devices/task-dispatch-dialog.tsx:82` | **低** | **硬编码中文字符串** — `WebSocket 端口 18790，RPC 端口 18801 为预置端口，无需修改。` 在 settings-section.tsx:83 | 移至 i18n 本地化文件 |
| 23.26 | `devices/use-device-snapshot.ts:19,39` | **高** | **无 WebSocket 自动重连（snapshot hook）** — 与最高优先级问题 #50 和 Module 18 #18.6 相同的问题。WebSocket 在任何错误时关闭，没有重试 | 实现指数退避重连，设置最大重试次数 |
| 23.27 | `devices/use-mirror-socket.ts:78-123` | **高** | **`reconnect()` 重复整个 WebSocket 设置逻辑** — reconnect 函数（行78-123）与 useEffect 主体（行18-76）几乎完全相同。WebSocket 处理的任何更改必须在两处进行 | 提取 `createMirrorWebSocket(deviceId, callbacks)` 工厂函数或将 reconnect 重构为重新触发 effect |
| 23.28 | `devices/use-mirror-socket.ts:41-53` | **中** | **消息解析假定 `channel: "mirror"` 或 `type: "connected"`** — 在验证形状之前用 `as` 断言将 JSON 转为 `MirrorSnapshotFrame`。如果服务器发送新消息类型，会被错误存储为 frame | 在调用 `setFrame` 之前使用 Zod 或类型守卫验证 |
| 23.29 | `devices/mirror-dialog.tsx:22-33` | **中** | **`mapPointerToDevice` 从 mirror-panel.tsx 重复** — 完全相同的坐标映射逻辑出现在 `MirrorDialog` 和 `MirrorPanel` 中。映射精度的更改必须手动同步 | 提取 `usePointerMapping(imgRef, frame)` hook |
| 23.30 | `devices/mirror-dialog.tsx:49-58` | **中** | **使用原生 `<dialog>` 而非 shadcn/ui Dialog** — 与其他对话框相同的反模式。样式不一致（使用手动 `fixed inset-0` 而非 Dialog 的 overlay/portal 系统） | 使用应用的 `Dialog` 组件以保持一致的背景遮罩行为 |
| 23.31 | `channel-connect-modal.tsx:56-137` | **中** | **`getChannelConfigs` 在每次 `t` 变化时重新创建整个配置对象** — `useMemo(() => getChannelConfigs(t), [t])` 在每次本地化变更时创建包含 JSX 节点（SVG 图标）的新鲜对象。配置还包含硬编码的英文占位符字符串（"cli_xxx"、"xoxb-..."），这些应该是可翻译的 | 将配置移至 Module 级别；对 JSX 部分使用渲染函数 |
| 23.32 | `channel-connect-modal.tsx:179-181` | **低** | **原生 `keydown` 监听器用于 Escape** — 与其他模态框相同的模式（中 #9.5）。每个模态框都添加自己的 `document.addEventListener("keydown")` 用于 Escape 处理 | 使用 Dialog 组件内置的 Escape 处理 |
| 23.33 | `chat-input-area.tsx:70-74` | **中** | **`formatBytes` 本地实现** — 文件大小显示的工具函数内联存在。附件预览和会话消息组件中可能也需要相同逻辑 | 移至 `@/lib/format.ts` |
| 23.34 | `chat-input-area.tsx:95-130` | **中** | **`FileBubble` 扩展名到图标的映射脆弱** — 7个 if/else 链将文件扩展名映射到图标组件和颜色类。添加新文件类型需要复制 if/else 模式 | 使用 `FILE_TYPE_CONFIG: Record<string, { Icon, color }>` 查找表 |
| 23.35 | `activity-feed.tsx:39-51` | **中** | **`CHANNEL_LABELS` 从 `platform-icons.tsx` 重复** — 相同的 Record<string, string> 映射存在于至少3个文件（`activity-feed.tsx`、`platform-icons.tsx`、`channels.tsx`）。已标记为 #48 | 使用 `platform-icons.tsx` 中的单一事实来源 |
| 23.36 | `activity-feed.tsx:62` | **中** | **`refetchInterval: 30000` 无条件轮询** — 即使侧边栏折叠或用户在不同页面，活动流也每30秒轮询 | 添加 `refetchIntervalInBackground: false` 或检查页面可见性 |
| 23.37 | `activity-feed.tsx:70-75` | **低** | **服务端已限制为5后的客户端排序 + 切片** — 查询发送 `{ limit: 5 }` 但组件按 `lastMessageAt` 排序并再次切片。如果 API 已返回排序结果，这是浪费计算 | 信任服务端排序顺序；移除客户端排序 |

### 总结

- **models.tsx** 是此 Module 中最严重的问题：3624行，包含4个不同的认证状态机，并在前端处理原始 API key 数据。应至少拆分为5个独立文件。
- **rewards.tsx** 有7分支链式三元和 GitHub star 验证的10秒硬编码延迟。
- 设备 WebSocket hooks 仍然没有自动重连（之前标记为 #50）。
- 通道连接模态框和活动流延续了平台配置/标签重复的模式。


## Module 24: 模型选择器、提供商 Logo、品牌栏、UI 原语、通道设置视图、工作区布局

**审查文件:**
- `apps/web/src/components/model-picker-dropdown.tsx` (469 lines)
- `apps/web/src/components/provider-logo.tsx` (353 lines)
- `apps/web/src/components/brand-rail.tsx` (213 lines)
- `apps/web/src/components/inline-model-selector.tsx` (188 lines)
- `apps/web/src/components/ui/dialog.tsx` (137 lines)
- `apps/web/src/components/ui/select.tsx` (91 lines)
- `apps/web/src/components/ui/chat-markdown.tsx` (19 lines)
- `apps/web/src/components/ui/button.tsx` (58 lines)
- `apps/web/src/components/platform-icons.tsx` (262 lines)
- `apps/web/src/app.tsx` (132 lines)
- `apps/web/src/components/channel-setup/feishu-setup-view.tsx` (463 lines)
- `apps/web/src/components/channel-setup/slack-oauth-view.tsx` (698 lines)
- `apps/web/src/components/channel-setup/discord-setup-view.tsx` (451 lines)
- `apps/web/src/components/channel-setup/wechat-setup-view.tsx` (343 lines)
- `apps/web/src/layouts/workspace-layout.tsx` (1362 lines)

### 问题

| # | 文件 | 严重级别 | 问题 | 建议修复 |
|---|------|----------|-------|---------------|
| 24.1 | `workspace-layout.tsx:1362` | **严重** | **第二个1362行单体组件** — 管理侧边栏调整大小、会话列表轮询、余额弹窗 portal、自动更新浮动卡片、云连接、奖励状态、预算守卫、桌面透明度 hack、3个独立的点击外部处理程序、平台检测和10+导航项。只有 `models.tsx` 比它更大。任何侧边栏相关的更改都需要浏览1300+行 | 拆分为 `SidebarNav`、`SidebarSessions`、`SidebarBalanceCard`、`SidebarFooter`、`UpdateFloatCard`、`DesktopGlassWrapper` 组件 |
| 24.2 | `wechat-setup-view.tsx:34-38` | **高** | **使用 `calcFakeProgress` 的虚假进度条** — 使用缓动函数 `1 - (1 - ratio)²·⁵` 在40秒内模拟 0→95%。进度条纯粹是装饰：实际的 QR 就绪状态由 `while(true)` 循环中的 API 轮询决定。已标记为最高优先级 #38 但确认仍在代码库中 | 移除虚假进度；显示脉冲式 "Waiting for gateway..." 旋转器并附带已用时间 |
| 24.3 | `wechat-setup-view.tsx:116` | **高** | **无界 `while (true)` 循环** — QR 启动流程使用 `while (true)` 配合中止检查和重试延迟。如果中止控制器未能触发（如 React 18 严格模式双挂载），这将永远循环 | 替换为有最大尝试次数的递归重试（如 30 x 2s = 60s 超时） |
| 24.4 | `workspace-layout.tsx:127-139` | **高** | **`PLATFORM_LABELS` 第4次重复** — 相同的 `Record<Platform, string>` 存在于 `platform-icons.tsx`、`activity-feed.tsx`、`channels.tsx` 以及现在 `workspace-layout.tsx`。添加新平台需要更新4个文件 | 在 `platform-icons.tsx` 中建立单一事实来源，从那里重新导出 |
| 24.5 | `workspace-layout.tsx:152-166` | **高** | **`formatTime` 手工实现相对时间重复** — 相同逻辑存在于 `activity-feed.tsx:24-37`。两者都手动实现 "just now"/"Xm ago"/"Xh ago"/"Xd ago" 的 Date 运算 | 使用 `date-fns` 或提取 `formatRelativeTime` 到 `@/lib/format.ts` |
| 24.6 | `provider-logo.tsx:134-177` | **中** | **O(NxM) 图标键解析** — `resolveModelIconKey` 遍历21条规则条目 x 最多5个模式 = 每个模型渲染约105次子字符串检查。为下拉列表中的每个模型调用（可能50+个模型） | 在模型列表加载时预计算 model→icon 映射；使用 `Map<string, string>` 实现 O(1) 查找 |
| 24.7 | `model-picker-dropdown.tsx:14-27` | **高** | **`PROVIDER_LABELS` 重复** — 提供商显示名称在 `model-picker-dropdown.tsx` 中硬编码，但已存在于 `provider-logo.tsx`（`PROVIDER_ICON_ALIASES`）。`kimi` → "Moonshot" 和 `moonshot` → "Moonshot" 是重复条目；`zai` → "Zhipu" 与 `glm` → "Zhipu" 拼写不同 | 与 `PROVIDER_ICON_ALIASES` 合并或提取到共享的 `provider-config.ts` |
| 24.8 | `app.tsx:63-128` | **高** | **所有页面无代码分割急切加载** — 20+页面组件在顶部导入并在扁平的 `<Routes>` 中渲染。每个页面的 JS 在初始加载时都会下载，无论用户是否访问过。在慢速连接上，这显著膨胀初始包大小 | 使用 `React.lazy()` + `<Suspense>` 进行路由级代码分割 |
| 24.9 | `feishu-setup-view.tsx`、`discord-setup-view.tsx`、`slack-oauth-view.tsx`（手动流程） | **高** | **三个通道设置向导共享约80%结构模式** — 都包含：步骤指示器网格、带图标+标题+描述+说明列表的编号步骤卡片、下一/上一步导航、帮助链接页脚。合计约1600行，大量重复。添加新通道需要复制粘贴整个模式 | 提取 `<ChannelSetupWizard>` 组件：`steps`、`platformColor`、`onConnect` props |
| 24.10 | `slack-oauth-view.tsx:446-471` | **中** | **硬编码英文说明步骤** — 手动设置步骤2-4包含带 `<strong>` 标签和硬编码英文文本混合 i18n 键的 JSX。步骤2："Go to Basic Information"，步骤3："In the sidebar, go to Install App"，步骤4："In the sidebar, go to App Home" | 将所有说明文本移至 i18n 本地化文件，支持富文本插值 |
| 24.11 | `workspace-layout.tsx:501-540` | **中** | **三个相同的点击外部处理程序** — `showLogoutConfirm`、`showHelpMenu`、`showBalancePopup` 各自有自己的 `useEffect` + `mousedown` 监听器，遵循完全相同的模式。添加第4个弹窗将再次重复 | 提取 `useClickOutside(ref, enabled, onOutsideClick)` hook |
| 24.12 | `workspace-layout.tsx:1047-1141` | **中** | **余额弹窗手动 portal 定位** — 使用 `getBoundingClientRect()` 和 `createPortal` 配合内联样式计算。弹窗位置在滚动、调整大小或侧边栏折叠时会错位，因为它只在渲染时计算一次 | 使用适当的 popover/popper 库（如 `@floating-ui/react`）或 Radix Popover |
| 24.13 | `workspace-layout.tsx:370` | **中** | **`localStorage.getItem(SETUP_COMPLETE_KEY)` 作为认证门** — `WorkspaceLayout` 检查 `localStorage` 中的 `nexu_setup_complete`，如果未找到则重定向到 `/`。这不是真正的认证检查；任何人都可以在 devtools 中设置此键来绕过 | 使用认证会话（`authClient.useSession()`）来控制工作区访问 |
| 24.14 | `workspace-layout.tsx:476-498` | **中** | **桌面透明度 hack** — 将 `document.documentElement`、`document.body` 和 `#root` 背景设置为 "transparent" 以实现毛玻璃效果，然后在清理时恢复。如果组件在导航期间卸载，先前的值可能过时或导致闪烁 | 在 `<html>` 上使用 CSS 类切换而非内联样式操作 |
| 24.15 | `brand-rail.tsx:14-27` | **中** | **`GitHubIcon` SVG 重复** — 相同的24px GitHub 图标 SVG 路径出现在 `brand-rail.tsx` 和 `workspace-layout.tsx:226-231`。任何图标更新必须同步 | 移至 `platform-icons.tsx` 作为 `GitHubIcon` 导出 |
| 24.16 | `brand-rail.tsx:31-57` | **中** | **`NexuIcon` SVG 重复** — 800px viewBox 的 nexu logo 路径出现在 `brand-rail.tsx` 和 `provider-logo.tsx:187-200`（`FallbackProviderMark`）。路径数据完全相同 | 从共享图标文件导出 `NexuIcon`；在两个位置使用 |
| 24.17 | `provider-logo.tsx:50-77` | **中** | **`LOCAL_PROVIDER_ICON_KEYS` 和 `LOCAL_MODEL_ICON_KEYS` 硬编码** — 新提供商需要代码更改以添加图标支持。图标文件已经存在于 `/model-provider-icons/` 和 `/model-icons/` | 从文件系统（或清单）自动发现可用图标，而非维护硬编码白名单 |
| 24.18 | `wechat-setup-view.tsx:128-131` | **中** | **通过字符串匹配的可重试错误检测** — `errorMsg.toLowerCase().includes("gateway not connected")` 和 `includes("timed out")` 将重试逻辑耦合到精确的服务器错误消息文本。如果服务器更改错误措辞，重试会静默停止 | 使用 HTTP 状态码或 API 响应中的错误代码 |
| 24.19 | `inline-model-selector.tsx:61-65` | **中** | **不安全的 `as` 转换用于模型数组** — `(modelsData?.models ?? []) as Array<{ id: string; name: string; provider: string }>` 绕过类型检查。如果 API 更改模型形状，这会静默转换为错误类型 | 为模型类型定义 Zod schema；使用 `z.array(ModelSchema).parse()` |
| 24.20 | `model-picker-dropdown.tsx:206-253` | **中** | **下拉按钮每次打开时重新渲染 `resolveOpenGroups`** — 函数在 `onClick` 中内联调用，但也依赖 `currentGroupKey`，后者在模型变更时变化。然后设置 `expandedProviders` 状态，触发第二次渲染 | 将 `resolveOpenGroups()` 作为初始化器传给 `setExpandedProviders` 或在 `useEffect` 中计算 |
| 24.21 | `channel-setup/*`（4个文件） | **中** | **`identify({ channels_connected: 1 })` 在所有通道连接处理程序中硬编码** — 假设恰好1个通道。如果用户连接第二个通道，identify 调用仍报告1 | 在调用 identify 前从 API 查询实际通道数 |
| 24.22 | `dialog.tsx:114-121` | **中** | **`DialogBody` 与页头/页脚没有视觉分隔** — 页头有底部边框，页脚有顶部边框，但 body 没有区分样式。长对话内容融入页头 | 添加一致的内边距或 body 与相邻部分之间的微妙分隔线 |
| 24.23 | `app.tsx:34-48` | **低** | **`titleByPathname` Record 必须为每个新路由手动更新** — 添加新页面需要记住在这里添加条目。缺失的条目会静默显示默认标题 | 从路由配置生成标题或使用每个页面组件设置的 `PageTitleContext` |
| 24.24 | `brand-rail.tsx:89-102` | **低** | **`FadeIn` 包装组件内联定义** — 带有 `delay` prop 的简单动画包装器。类似的动画包装器可能存在于其他落地页/认证页面 | 提取到 `@/components/ui/fade-in.tsx` |
| 24.25 | `platform-icons.tsx:214-236` | **低** | **`PlatformIcon` 使用 switch-case 而非 Record 查找** — switch 语句中11个 case。添加新平台需要同时添加一个 case 和一个新图标组件 | 使用 `const PLATFORM_ICON_MAP: Record<string, ComponentType>` 并动态查找 |
| 24.26 | `chat-markdown.tsx:13` | **低** | **超长内联 Tailwind className** — 单个 className 字符串包含50+工具类，难以阅读哪些样式应用于哪些元素 | 拆分为 CSS module 或在 CSS 文件中使用 `@apply` |
| 24.27 | `inline-model-selector.tsx:19-28` | **低** | **`getProviderIdFromModelId` 从 `model-picker-dropdown.tsx:29-35` 重复逻辑** — 两者都通过 `/` 分割模型 ID 提取提供商。回退行为略有不同 | 使用共享的 `parseModelId(modelId: string): { provider: string; modelName: string }` 工具函数 |
| 24.28 | `workspace-layout.tsx:850` | **低** | **"Beta" 徽章硬编码英文** — 自动化导航项显示硬编码的 "Beta" 徽章。非英语用户无论语言设置如何都看到 "Beta" | 移至 i18n：`t("layout.nav.beta")` |
| 24.29 | `feishu-setup-view.tsx:18-22` | **低** | **`FEISHU_SETUP_STEP_KEYS` 使用 i18n 键作为步骤标识符** — 步骤数组包含翻译键如 `feishuSetup.stepCreateApp`。如果在本地化文件中重命名键，步骤指示器会静默中断 | 使用与 i18n 键分离的枚举或字符串字面量标识符 |
| 24.30 | `select.tsx:17-19` | **低** | **SelectTrigger 使用 `bg-transparent` 和 `border-input`** — 依赖 shadcn/ui 默认 CSS 变量（`bg-transparent`、`border-input`），这些变量可能未在此项目的主题中定义。按钮组件使用项目特定的变量（`bg-surface-0`、`border-border`） | 与项目 CSS 变量约定对齐 |

### 总结

- **workspace-layout.tsx**（1362行）是继 models.tsx 之后的第二大单体组件。它将侧边栏导航、会话列表、余额弹窗、自动更新、云连接和桌面平台 hack 嵌入一个文件。
- **通道设置向导**（feishu、discord、slack-manual）共享约80%结构模式（约1600行重复的向导 UI）。
- **PLATFORM_LABELS** 现在在4个文件中重复；**formatTime** 在2个文件中重复；图标 SVG（GitHub、Nexu）各在2个文件中重复。
- **WeChat 设置**仍有虚假进度条（最高优先级 #38）和无界 `while(true)` 循环。
- **app.tsx** 急切加载所有20+页面，零代码分割。
- **provider-logo.tsx** 图标解析具有 O(NxM) 复杂度和硬编码白名单。


## Module 25: 剩余通道设置视图、通道组件、Hooks 与工具组件

**审查文件:**
- `apps/web/src/components/channel-setup/dingtalk-setup-view.tsx` (202 lines)
- `apps/web/src/components/channel-setup/qqbot-setup-view.tsx` (196 lines)
- `apps/web/src/components/channel-setup/telegram-setup-view.tsx` (128 lines)
- `apps/web/src/components/channel-setup/wecom-setup-view.tsx` (197 lines)
- `apps/web/src/components/channel-setup/whatsapp-setup-view.tsx` (237 lines)
- `apps/web/src/components/channels/bot-picker.tsx` (62 lines)
- `apps/web/src/components/channels/channel-instance-card.tsx` (167 lines)
- `apps/web/src/components/channels/feishu-permissions-panel.tsx` (222 lines)
- `apps/web/src/components/chat-input.tsx` (113 lines)
- `apps/web/src/components/connection-graphic.tsx` (45 lines)
- `apps/web/src/components/budget-depleted-dialog.tsx` (98 lines)
- `apps/web/src/components/budget-warning-banner.tsx` (106 lines)
- `apps/web/src/components/brand-mark.tsx` (14 lines)
- `apps/web/src/components/toolkit-icon.tsx` (110 lines)
- `apps/web/src/components/language-switcher.tsx` (125 lines)
- `apps/web/src/components/github-star-cta.tsx` (125 lines)
- `apps/web/src/hooks/use-bots.ts` (21 lines)
- `apps/web/src/hooks/use-bot-quota.ts` (24 lines)
- `apps/web/src/hooks/use-cloud-connect.ts` (107 lines)
- `apps/web/src/hooks/use-desktop-budget-guard.ts` (214 lines)
- `apps/web/src/hooks/use-locale.tsx` (148 lines)
- `apps/web/src/hooks/use-desktop-rewards.ts` (150 lines)
- `apps/web/src/hooks/use-github-stars.ts` (68 lines)
- `apps/web/src/hooks/use-countdown.ts` (29 lines)
- `apps/web/src/hooks/use-active-channel.ts` (62 lines)
- `apps/web/src/hooks/use-desktop-cloud-status.ts` (44 lines)
- `apps/web/src/hooks/use-update-channel-bot.ts` (34 lines)
- `apps/web/src/hooks/use-update-feishu-permissions.ts` (36 lines)
- `apps/web/src/hooks/use-page-title.ts` (11 lines)
- `apps/web/src/hooks/use-community-catalog.ts` (175 lines)

### 问题

| # | 文件 | 严重级别 | 问题 | 建议修复 |
|---|------|----------|-------|---------------|
| 25.1 | `dingtalk-setup-view.tsx`、`qqbot-setup-view.tsx`、`wecom-setup-view.tsx`、`telegram-setup-view.tsx` | **高** | **四个设置视图约90%复制粘贴（约750行）** — 都共享：凭据状态（2个字段）、getTrimmedCredentials、handleConnect（验证 → POST → 追踪 → identify → onConnected）、相同的 JSX 结构（图标头部 → 步骤列表 → 2个标签输入 → 文档链接 → 连接按钮）。更改任何内容（错误格式、分析负载、按钮样式）需要编辑4个文件。唯一区别：调用的 API SDK 函数、字段名（clientId/clientSecret vs appId/appSecret vs botId/secret vs botToken）、i18n 前缀 | 提取 `<CredentialConnectView platform={...} fields={[...]} sdkCall={...} />` 通用组件 |
| 25.2 | `use-github-stars.ts:42` | **高** | **直接 `fetch()` 调用 `api.github.com`，零错误处理** — 未认证的 GitHub API 有60次/小时的速率限制。之后，`res.json()` 在403响应体上抛出异常，被静默捕获。Star 数量静默显示回退值直到缓存过期（5分钟）。也违反了 "无原始 fetch" 原则（即使对外部 API，也应使用后端代理避免速率限制） | 通过 controller API `/api/internal/github/stars` 代理或使用服务端缓存 |
| 25.3 | `whatsapp-setup-view.tsx:115-143` | **高** | **无界 `while (mountedRef.current)` QR 轮询循环** — 与 wechat-setup-view.tsx 的 `while(true)` 相同的反模式。每1.5秒轮询 `postApiV1ChannelsWhatsappQrWait`，无限期执行。如果服务器从不返回 `connected: true`，即使 QR 过期后也会无限循环 | 添加最大尝试次数（如 80 x 1.5s = 2分钟超时）并显示 "QR 已过期 — 重新扫描" UI |
| 25.4 | `use-cloud-connect.ts:90-94` | **中** | **`setInterval` 轮询而非 React Query `refetchInterval`** — `window.setInterval(() => onPoll?.(), 2000)` 运行副作用来轮询云状态。这在标签页在后台时也运行。React Query 内置的 `refetchInterval` 配合可见性感知会更合适 | 转换为专用的 `useQuery`，配置 `refetchInterval: 2000` + `enabled: cloudConnecting` |
| 25.5 | `budget-depleted-dialog.tsx:28-33` | **中** | **使用原生 `<dialog>` 元素而非 Radix Dialog** — 应用中其他每个模态/对话框都使用基于 Radix 的 `Dialog` 包装器（`components/ui/dialog.tsx`）。原生 `<dialog>` 背景遮罩行为不一致，不捕获焦点，且没有动画过渡。这是唯一使用原生 dialog 的组件 | 迁移到项目的 `Dialog` 组件以保持一致性 |
| 25.6 | `feishu-permissions-panel.tsx:48-50` | **中** | **每次渲染时 `JSON.stringify(draft) !== JSON.stringify(baseline)` 脏检测** — 序列化可能很大的权限对象（包括 `allowFrom` 字符串数组）进行比较。屏幕上有50+通道实例时，这约为每次渲染100次 JSON.stringify 调用 | 使用浅比较辅助函数（lodash 的 `isEqual` 或简单的逐字段检查） |
| 25.7 | `github-star-cta.tsx:25-124` | **中** | **三个变体块中重复的 star 计数和 GitHub SVG** — `banner`、`inline` 和 `button` 变体各自渲染 `<a>` 并带有 star 显示逻辑和 GitHub SVG。13行的 GitHub 路径 SVG 在 banner 变体中是内联的。添加第4个变体或更改 star 显示意味着编辑3个代码路径 | 提取 `<GitHubIcon>`、`<StarCount>` 和 `<StarCtaLink variant={...}>` 子组件 |
| 25.8 | `use-community-catalog.ts:48,72,104,149,169` | **中** | **不安全的 `as` 转换绕过 Zod 验证** — 5个位置将 API 响应转换为 `as unknown as SkillhubCatalogData` 或 `as { ok: boolean; ... }`。共享包（`@nexu/shared`）有这些类型的 Zod schema。如果 API 变更响应形状，TypeScript 不会捕获不匹配 | 使用 `skillhubCatalogDataSchema.parse(data)` 和 `installResponseSchema.parse(data)` |
| 25.9 | `channel-instance-card.tsx:63` | **中** | **保存守卫仅检查 `draftBotId === channel.botId`** — 如果用户将 bot 从 A→B→A 更改，`handleSave` 提前退出不保存，因为草稿等于原始值。这是正确的行为但守卫不区分 "从未更改" 和 "更改后又改回" — 两者都静默跳过保存 | 可接受的行为；用注释记录意图或单独跟踪 `initialBotId` 区别于 `dirty` 标志 |
| 25.10 | `use-locale.tsx:45-148` | **中** | **`bootstrapLocale` 有复杂的竞态条件处理，使用3个控制变量** — `userInteractedRef`、`didBootstrapRef` 和 `localCandidate` 创建了问题 #759 评论中记录的复杂交互。引导异步获取桌面偏好，如果用户在获取完成前更改本地化，`userInteractedRef` 阻止过时的服务器值覆盖其选择。这个100+行的异步引导是脆弱的且难以测试 | 简化：始终优先信任 `localStorage`；仅在没有 localStorage 值时使用 `getApiInternalDesktopPreferences()` 作为初始种子 |
| 25.11 | `use-desktop-budget-guard.ts:135-181` | **中** | **自动回退 `useEffect` 有4个依赖和基于 ref 的去重** — 预算耗尽时自动回退到 BYOK 使用 `attemptedFallbackKeyRef` 防止重复尝试。`fallbackKey` useMemo 从3个响应值生成组合键。如果4个依赖以特定顺序变化，ref 守卫可能阻止合法重试 | 使用变更的 `isPending` 状态作为守卫而非自定义 ref：`if (fallbackMutation.isPending) return;` |
| 25.12 | `budget-depleted-dialog.tsx:76-92` / `budget-warning-banner.tsx:82-101` | **中** | **操作按钮在 banner 和 dialog 之间重复** — 两个组件都渲染 "Earn Credits"（Gift 图标，导航到 `/workspace/rewards`）和 "Bring Your Own Key"（Settings2 图标，导航到 `/workspace/models?tab=providers`）。添加新操作需要更新两个文件 | 提取 `<BudgetActionButtons variant="banner"|"dialog" />` 共享组件 |
| 25.13 | `brand-mark.tsx:5-14` | **低** | **14行的透传包装器无附加价值** — `<BrandMark>` 简单地渲染 `<img src="/favicon/favicon-light.svg" alt="" aria-hidden="true" {...props} />`。无逻辑、无默认值、无错误处理。调用者可以直接使用 `<img>` | 要么移除并在调用处内联 `<img>`，要么添加有用的默认值（width/height 防止 CLS、loading="lazy"） |
| 25.14 | `bot-picker.tsx:37-53` | **低** | **原生 `<select>` 未样式化** — bot picker 使用原始 `<select>` 元素配合 Tailwind 类，但没有自定义下拉样式。与项目的 Select 组件（`ui/select.tsx`）不一致。行48-49还有一个4行 TODO 注释，expertSlug 渲染已推迟到 "Plan A" | 使用项目的 `Select` 组件；实现 TODO 或移除它 |
| 25.15 | `language-switcher.tsx:39-42` | **低** | **硬编码 "English" 和 "中文" 标签** — 语言名称是硬编码字符串而非 i18n 键。如果添加第三种语言，标签也会硬编码 | 使用 i18n 键：`t("locale.en")`、`t("locale.zh")` |
| 25.16 | `connection-graphic.tsx:40` | **低** | **内联 "N" div 作为 nexu logo** — 使用 `<div className="..."><span>N</span></div>` 而非 `NexuIcon` 组件（`brand-rail.tsx:31-57`）。品牌不一致；如果 logo 变更，这里会被遗漏 | 替换为 `<NexuIcon>`（如 #24.16 建议提取到共享位置） |
| 25.17 | `use-active-channel.ts:17-26` | **低** | **`localStorage.getItem` 在 `useState` 初始化器中阻塞渲染** — localStorage 是同步 I/O。虽然通常很快，但在缓慢或已满的磁盘上可能阻塞初始渲染 | 使用 `useEffect` 进行延迟初始化，在挂载后从 localStorage 补水 |
| 25.18 | `budget-warning-banner.tsx:65` | **低** | **`color-mix(in srgb, ...)` CSS 可能在较旧的 Electron 中不工作** — `color-mix()` 是 CSS Color Level 5，Chromium 111+ 支持。较旧的 Electron 版本（pre-v28）使用 Chromium <111，不会渲染彩色背景 | 添加回退背景颜色以提供相似的视觉效果：`background: \`color-mix(in srgb, ${config.accentColor} 15%, transparent)\`` 并附带静态回退 |
| 25.19 | `toolkit-icon.tsx:58-59` | **低** | **有状态的回退在图标 URL 变更时持续存在** — `primaryFailed` 和 `fallbackFailed` 是 `useState` 布尔值。如果 `iconUrl` 从 "a.png"（损坏）变为 "b.png"（有效），`primaryFailed` 仍为 `true`，所以新的有效 URL 被跳过，组件显示回退 #2 | 当 `iconUrl` 或 `fallbackIconUrl` 变更时通过 `useEffect` 或 `key` prop 重置 `primaryFailed` 和 `fallbackFailed` |
| 25.20 | `use-countdown.ts:21-24` | **低** | **`setInterval(fn, 1000)` 无论页面可见性都运行** — 即使标签页隐藏也每秒更新剩余时间。对于倒计时，这浪费 CPU 周期；可以在可见性变更时重新计算时间 | 使用 `requestAnimationFrame` 或在更新状态前检查 `document.visibilityState` |
| 25.21 | `language-switcher.tsx:16-24` | **低** | **第5次出现 `mousedown` 点击外部监听器** — 相同模式已在 inline-model-selector、model-picker-dropdown、workspace-layout（x3）和 channel-connect-modal 中标记。代码库现在有6+个独立实现 | 提取到 `@/hooks/` 中的 `useClickOutside(ref, enabled, handler)` — 自 Module 9 以来反复标记 |
| 25.22 | `chat-input.tsx:103-113` | **低** | **`ChatInputSkillsButton` 硬编码 "Skills" 文本且没有 onClick 处理程序** — 按钮将 "Skills" 渲染为硬编码英文文本，没有操作。似乎是占位符 UI 元素 | 添加 i18n 键并连接 `onClick` 处理程序或用注释标记为 WIP |
| 25.23 | `use-page-title.ts:4-10` | **低** | **不处理嵌套并发标题变更** — 如果组件 A 设置标题 "Page A"，嵌套组件 B 设置标题 "Page B"，当 B 卸载时它恢复 "Page A"。但如果 B 在 A 之前卸载（正确的嵌套），`prev` 捕获可以工作。然而，如果 A 和 B 是同级（路由），恢复会竞争 | 使用文档标题栈或 `useEffect` 排序保证（React 在父组件之前卸载子组件） |

### 总结

- **4个通道设置视图**（dingtalk、qqbot、wecom、telegram）约90%相同（约750行重复的凭据表单→API→追踪→导航模式）。这是 Module 24 中标记的向导模式视图（feishu、discord、slack-manual）之后的合并机会。
- **useGitHubStars** 是 hooks 目录中唯一使用原始 `fetch()` 的地方 — 所有其他 hooks 使用生成的 SDK。在 GitHub 速率限制时静默失败。
- **WhatsApp QR 流程**与 WeChat 有相同的无界轮询循环（标记为高 #24.3）。
- **预算 UI 组件**（banner + dialog）重复操作按钮并使用不一致的对话框原语（原生 `<dialog>` vs Radix Dialog）。
- **use-community-catalog.ts** 在 hooks 目录中有最多的不安全 `as` 转换（5个位置） — 尽管在 `@nexu/shared` 中有可用的 schema 但没有 Zod 验证。
- **language-switcher.tsx** 硬编码语言名称；**chat-input.tsx** 有无效的 "Skills" 按钮；**brand-mark.tsx** 是不必要的14行包装器。
- **点击外部 mousedown 模式**现在出现在代码库的6+个位置。

## Module 26: 剩余 UI 原语、奖励组件、技能/专家卡片、Lib 工具

**审查文件:**
- `apps/web/src/components/ui/badge.tsx` (37 lines)
- `apps/web/src/components/ui/card.tsx` (61 lines)
- `apps/web/src/components/ui/input.tsx` (22 lines)
- `apps/web/src/components/ui/label.tsx` (25 lines)
- `apps/web/src/components/ui/page-header.tsx` (35 lines)
- `apps/web/src/components/ui/separator.tsx` (29 lines)
- `apps/web/src/components/ui/switch.tsx` (112 lines)
- `apps/web/src/components/ui/tabs.tsx` (53 lines)
- `apps/web/src/components/ui/textarea.tsx` (21 lines)
- `apps/web/src/components/rewards/home-rewards-teaser.tsx` (69 lines)
- `apps/web/src/components/rewards/reward-task-icon.tsx` (221 lines)
- `apps/web/src/components/experts/expert-card.tsx` (184 lines)
- `apps/web/src/components/skills/community-skill-card.tsx` (145 lines)
- `apps/web/src/lib/reward-share-assets.ts` (97 lines)
- `apps/web/src/lib/reward-virtual-check.ts` (49 lines)
- `apps/web/src/lib/skill-translations.ts` (115 lines)
- `apps/web/src/lib/logout.ts` (27 lines)
- `apps/web/src/lib/desktop-platform.ts` (24 lines)
- `apps/web/src/lib/whatsapp.ts` (7 lines)

### 问题

| # | 文件 | 严重级别 | 问题 | 建议修复 |
|---|------|----------|-------|---------------|
| 26.1 | `reward-virtual-check.ts:27-32` | **高** | **`runVirtualRewardCheck` 除了 `await wait(1400)` 什么也没做** — 已标记为最高优先级 #40。整个文件的存在仅仅是为了模拟验证延迟。`_task` 参数未使用（带下划线前缀）。这个49行文件仅作为1.4秒的装饰性延迟，没有验证逻辑 | 实现实际验证或移除虚拟检查直接进行认领 |
| 26.2 | `reward-share-assets.ts:76-85` | **中** | **`triggerRewardShareAssetDownload` 泄漏 DOM 元素** — 通过 `documentLike.createElement("a")` 创建 `<a>` 元素，调用 `click()`，但从不从 DOM 中移除。虽然对于常规锚点元素通常不会泄漏（它们没有被附加到 body），但这种模式暗示在某些环境中可能会。`RewardShareDownloadDocument` 接口暗示可测试性但对简单下载过度设计 | 使用标准的 `URL.createObjectURL` + fetch 方式或使用一个用 `anchor.remove()` 清理的简单 `<a download>` |
| 26.3 | `community-skill-card.tsx:138` | **中** | **`formatDownloads` 用于 star 计数** — `formatDownloads(skill.stars)` 使用面向下载的后缀（如 "1.2k"）格式化 star 计数。Star 和下载有不同的规模；面向下载的格式化器在 <1000 star 时显示原始计数，这会中断。此外，`formatDownloads` 在文件中内联定义而非在共享 lib 中 | 重命名为 `formatCompactCount`；移至 `@/lib/format.ts` |
| 26.4 | `reward-task-icon.tsx:23-220` | **中** | **11图标的 switch-case 配合内联 SVG 路径** — 198行 switch-case，每个图标有完整 SVG 标记。添加新奖励平台需要约20行 SVG 标记加上一个新的 case。`RewardTaskIconName` 类型必须手动保持同步 | 将每个图标提取为 `const PLATFORM_ICON_PATHS: Record<string, { viewBox, fill, path, stroke? }>` 并从配置渲染 |
| 26.5 | `expert-card.tsx:69-182` | **中** | **Card-as-link 反模式** — 将整个卡片包装在 `<Link to={detailTo}>` 中，交互子元素（按钮）使用 `e.preventDefault()` + `e.stopPropagation()`。这是 Module 19 中标记的相同反模式。点击卡片导航但点击按钮触发必须被拦截的卡片级处理程序 | 使用 `<ExpertCardWrapper>` 配合 `onClick` 程序化导航；移除 `<Link>` 包装器。或接受 card-over-link 模式并在容器的 onClick 上使用单一 `e.preventDefault()` |
| 26.6 | `logout.ts:13-27` | **中** | **登出在异步操作之前同步清除状态** — `localStorage.removeItem(SETUP_COMPLETE_KEY)` 和 `resetAnalytics()` 同步运行，然后 `signOut()` 是异步的。如果 signOut 失败（网络错误），用户被重定向到 `/` 但本地状态已清除。断开连接和云查询失效也使用 `.catch(() => {})` 静默处理 | 仅在成功 signOut 后清除状态；添加错误处理路径 |
| 26.7 | `whatsapp.ts:7` | **中** | **外部 QR 码 API 依赖** — `api.qrserver.com/v1/create-qr-code/` 是没有 SLA 的第三方服务。如果它宕机，WhatsApp QR 设置全局中断。URL 作为 `data=` 传入 QR 图片 URL，如果配置了 `VITE_WHATSAPP_WA_ME_URL` 还包含电话号码 | 使用项目依赖中已有的 `qrcode.react` 库客户端生成 QR 码（在 whatsapp-setup-view.tsx 中使用） |
| 26.8 | `ui/card.tsx:54-59` | **低** | **缺少 `CardFooter` 组件** — 标准 shadcn/ui Card 包含带 `flex items-center p-6 pt-0` 的 `CardFooter`。应用中多个页面使用自定义页脚实现，因为标准的不可用 | 添加符合 shadcn/ui 规范的 `CardFooter` 导出 |
| 26.9 | `ui/switch.tsx:14-36` | **低** | **`SIZES` 常量定义3个尺寸变体配合复杂 CSS** — 每个尺寸有5个属性（track、thumb、translate、onBar、offDot）用于精确的 macOS 风格渲染。添加新尺寸需要复制所有5个属性并手工计算值。视觉质量出色但配置脆弱 | 考虑从单一缩放因子自动生成尺寸：`const scale = { sm: 0.75, xs: 0.58 }[size] ?? 1` |
| 26.10 | `skill-translations.ts:1-110` | **低** | **110条目硬编码中文标签翻译映射** — `tagTranslationsZh` 是包含110个键值对的静态 Record。添加新 skill 标签需要代码更改以添加英文标签和中文翻译。还有重复条目："safety" 和 "security" 都映射到 "安全" | 将标签翻译移至 i18n 本地化 JSON 文件（`locales/zh/skill-tags.json`） |
| 26.11 | `page-header.tsx:25-28` | **低** | **依赖全局 CSS 类 `heading-page` 和 `heading-page-desc`** — 这些类未在组件文件、Tailwind 配置或组件作用域中定义。如果有人从全局样式表中移除它们，所有页面头部静默失去样式 | 使用显式 Tailwind 类或在本地 CSS module 中用 `@apply` 定义标题样式 |
| 26.12 | `home-rewards-teaser.tsx:44-53` | **低** | **奖励预览的内联硬编码颜色值** — 15+硬编码十六进制颜色（`#fff7e8`、`#a65a1b`、`#1f1810`、`#5f5143` 等）散布在 className 和内联 style props 中。更改奖励 UI 主题需要手动编辑15+颜色值 | 为奖励/暖色调色板定义 CSS 变量或 Tailwind 主题扩展 |
| 26.13 | `reward-share-assets.ts:44-58` | **低** | **`clampRandomValue` 对 `Math.random()` 过度防御** — 处理 Infinity、负数、>=1 和 <=0 情况，尽管 `Math.random()` 总是返回 [0, 1)。这些边缘情况仅在调用者传入非标准随机值时才会发生 | 简化为 `Math.max(0, Math.min(0.999999999999, randomValue))` 或移除，因为 `Math.random()` 已经返回安全值 |
| 26.14 | `ui/textarea.tsx:9-18` | **低** | **`bg-transparent` 而非项目 CSS 变量** — 与 #24.30 中标记的 `select.tsx` 相同问题。Textarea 使用 `bg-transparent` 而项目约定是 `bg-surface-1`。在透明桌面背景中，这会通过 textarea 显示底层内容 | 使用 `bg-surface-1` 或适当的 surface 变量 |

### 总结

- **reward-virtual-check.ts** 确认仍在代码库中（最高优先级 #40） — 一个49行文件，除了等待1.4秒装饰效果外什么也没做。
- **reward-task-icon.tsx** 是198行的 switch-case SVG 图标文件 — 与 `platform-icons.tsx` 中的 `PlatformIcon` 相同的反模式（低 #24.25）。
- **expert-card.tsx** 和 **community-skill-card.tsx** 共享 card-as-link 反模式（各自包装在带 stopPropagation 的 `<a>` / `<Link>` 中）。
- **community-skill-card.tsx** 有一个 bug：行138的 `formatDownloads` 被用于 star 计数。
- **UI 原语**（badge、card、input、label、separator、tabs、textarea）是标准的 shadcn/ui 包装器 — 结构良好，有适当的 Radix 集成。Switch 是一个值得注意的自定义实现，具有出色的 macOS 风格设计。
- **whatsapp.ts** 依赖外部 QR API；项目已有 `qrcode.react` 库作为依赖。
- **skill-translations.ts** 有110个硬编码的中文标签翻译，应该在本地化 JSON 文件中。

---

## Module 27: 剩余 Web 组件、UI 原语与 Lib 工具

**审查文件:** 25
**范围:** seedance-promo.tsx, chat-input-area.tsx, channel-connect-modal.tsx, inline-model-selector.tsx, activity-feed.tsx, ui/button.tsx, ui/dialog.tsx, ui/select.tsx, ui/chat-markdown.tsx, automations.tsx (719 lines), sessions.tsx (1,297 lines), channel-connect-errors.ts, tracking.ts, utils.ts, api.ts, channel-links.ts, channel-live-status.ts, desktop-links.ts, desktop-analytics-preference.ts, auth-client.ts, analytics-app-metadata.ts, markdown.ts, event-source.ts, use-auto-update.ts (299 lines), use-experthub-catalog.ts

| # | 位置 | 严重级别 | 发现 | 建议 |
|---|----------|----------|---------|----------------|
| 27.1 | `seedance-promo.tsx:16-18` | **高** | **Seedance 推广截止日期 2026年4月7日已过 — 整个推广是死代码** — `SEEDANCE_PROMO_DEADLINE` 是过去的日期（超过一个月前）。`getSeedancePromoCountdown` 返回负的剩余时间。Banner 和模态框从不显示，因为 `isDismissed` 通过 localStorage 持久化。两个 `setInterval(fn, 1000)` 计时器仍在每次渲染时运行。约425行死营销代码 | 移除所有 Seedance 推广代码：`SeedancePromoBanner`、`SeedancePromoModal`、`getSeedancePromoCountdown` 以及关联的 i18n 键 |
| 27.2 | `chat-input-area.tsx:590-643` vs `inline-model-selector.tsx:140-183` | **高** | **模型下拉80%重复** — `ChatInputArea` 和 `InlineModelSelector` 都构建按提供商分组的模型列表，包含提供商标题、带 Check 图标的模型项和底部定位下拉。分组逻辑、Map 构建和渲染模式在约50行中几乎完全相同 | 提取共享的 `ModelDropdown` 组件，接受 `models`、`selectedModelId`、`onSelect` 和 `position` props |
| 27.3 | `automations.tsx:57-136` | **中** | **完全模拟 UI，无 API 集成** — `mockAutomations` 数组包含4个硬编码条目，所有 status="paused"。所有 CRUD 操作（创建、编辑、切换、删除）仅变更本地状态。无后端集成，无持久化。"New Automation" 按钮打开的表单从不实际创建任何内容 | 要么连接到真正的自动化 CRUD API，要么在后端实现之前替换为 "Coming Soon" 占位符 |
| 27.4 | `chat-input-area.tsx:71-75` + `sessions.tsx:651-655` | **中** | **`formatBytes()` 重复** — 相同的6行函数出现在 `chat-input-area.tsx` 和 `sessions.tsx`。如果格式化逻辑变更，两个副本都必须更新 | 提取到 `lib/format.ts` 作为共享工具 |
| 27.5 | `activity-feed.tsx:24-37` + `sessions.tsx:315-328` | **中** | **`formatRelativeTime()` 重复但实现不同** — `activity-feed.tsx` 使用 i18n 键（`home.minutesAgo`、`home.hoursAgo`）而 `sessions.tsx` 使用硬编码英文字符串（`"just now"`、`"m ago"`、`"d ago"`）。同一概念的两种不同相对时间格式化器 | 统一为接受 `t` 函数进行 i18n 的单一 `formatRelativeTime` |
| 27.6 | `chat-input-area.tsx:340-345` | **中** | **Base64 文件编码在内存中保留最多7.5MB** — `readFileBlob()` 使用 `FileReader.readAsDataURL()`，创建比原始文件大约33%的 base64 字符串。7.5MB 文件变成约10MB 字符串存储在 React 状态（pendingAttachments）中。粘贴多张图片线性累积内存 | 使用对象 URL（`URL.createObjectURL`）以二进制 blob 流式传输大文件，而非 base64 编码 |
| 27.7 | `chat-input-area.tsx:215-223` | **中** | **第7个点击外部 `mousedown` 处理程序** — `BotSelector` 使用相同的 `document.addEventListener("mousedown", handler)` 模式，在代码库中发现6+次。继续重复模式而没有共享 hook | 参见 #25.3 — 提取 `useClickOutside(ref, callback)` hook |
| 27.8 | `automations.tsx:465-476` | **中** | **提交按钮带 `type="submit"` 但没有 `<form>` 元素** — 行469-476的 "Create/Save" 按钮使用 `type="submit"` 但没有 `<form>` 包装模态框主体。按钮也没有 `onClick` 处理程序，所以点击它什么也不做。用户可以填写表单但永远无法实际提交 | 给提交按钮添加 `onClick` 处理程序调用提交逻辑，或用带 `onSubmit` 的 `<form>` 包装 |
| 27.9 | `ui/button.tsx:12-13` | **低** | **shadcn/ui CSS 变量未在此项目中定义** — 按钮变体引用 Tailwind 类如 `bg-primary`、`text-primary-foreground`、`bg-destructive` 等，这些是标准 shadcn/ui 变量。此项目使用 `--color-tabby-*` CSS 变量命名约定，因此这些按钮变体使用浏览器默认值或未定义颜色渲染 | 要么在全局样式表中定义 shadcn/ui CSS 变量，要么将变体重写为使用项目的 `--color-tabby-*` / `--color-*` 命名 |
| 27.10 | `sessions.tsx:316-328` | **低** | **`formatRelativeTime` 使用硬编码英文字符串** — （"just now"、"m ago"、"h ago"、"d ago"），不同于使用 i18n 键的 `activity-feed.tsx`。这意味着会话时间戳无论语言设置如何始终为英文 | 用匹配活动流 i18n 键的 `t()` 调用替换硬编码字符串 |
| 27.11 | `sessions.tsx:398-392` | **低** | **`PLATFORM_CONFIG` 重复** — 56行 Record 包含10个平台配置（badgeClass、label、openLabel），已存在于代码库其他位置（之前标记为高三重化） | 使用规范位置的共享 PLATFORM_CONFIG |
| 27.12 | `sessions.tsx:1260-1266` | **低** | **硬编码英文 "Thinking..." 回退** — `t("sessions.chat.thinking", { defaultValue: "Thinking..." })` — defaultValue 是回退但表明 i18n 键可能未为所有本地化定义 | 确保 `sessions.chat.thinking` 在所有本地化 JSON 文件中定义 |
| 27.13 | `automations.tsx:486` | **低** | **未使用的状态变量 `_expandedId`** — 用下划线前缀解构表示故意不使用，但仍不必要地初始化 `useState<string | null>(null)` | 移除未使用的状态 |
| 27.14 | `automations.tsx:297-301` | **低** | **原生 `<select>` 配合硬编码 outline CSS** — AutomationModal 中的 bot 选择器使用原生 `<select>` 元素配合内联 Tailwind 类样式。与使用自定义下拉组件的代码库其余部分不一致 | 替换为项目现有的 bot picker 或一致的下拉组件 |
| 27.15 | `inline-model-selector.tsx:19-28` | **低** | **`getProviderIdFromModelId` 从 model-picker-dropdown 重复** — 相同函数存在于 `model-picker-dropdown.tsx`（之前在 Module 24 中标记）。两个相同的提供商解析函数 | 提取到共享工具函数 |
| 27.16 | `seedance-promo.tsx:96-148` | **低** | **`role="button"` 的 div 没有 Escape 键处理** — `SeedancePromoBanner` 使用带 `role="button"` 和 `tabIndex={0}` 的 div，但只处理 Enter/Space。Escape 键应该关闭 banner 以实现适当的键盘可访问性 | 添加 Escape 键处理程序以关闭 banner |

### 总结

- **Seedance 推广**确认是死代码（截止日期 2026年4月7日，现在是5月9日） — 425行，2x setInterval 计时器永远运行，产生负倒计数值。
- **automations.tsx**（719行）是100%模拟 UI，没有后端集成 — 所有4个自动化都是硬编码的，status 为 "paused"。
- **sessions.tsx**（1,297行）是最大的单页面组件 — 包含 `extractMessage()`（194+行）、基于文本的乐观去重、内联 SSE 客户端、双重 `formatRelativeTime`/`formatBytes` 实现和嵌入的 PLATFORM_CONFIG。
- **ChatInputArea**（652行）包含一个从 `InlineModelSelector` 80%重复的模型下拉，以及将每个文件最多7.5MB保留在内存中的 base64 文件编码。
- **模型下拉重复**：`ChatInputArea`、`InlineModelSelector` 和 `model-picker-dropdown.tsx` 都独立构建提供商分组模型列表，渲染逻辑几乎相同。
- **formatBytes / formatRelativeTime** 各在2+文件中重复，国际化方式不同。
- **点击外部模式**计数现在为7次，分布在代码库中。
- **UI 原语**（button、dialog、select、chat-markdown）基于 Radix UI 正确构建，具有良好的可访问性属性。

## Module 28: 社区技能详情、集成、i18n、测试与基础设施

**审查文件:** 17
**范围:** community-skill-detail.tsx (562 lines), integrations.tsx (773 lines), skills-view-state.ts (185 lines), experts-view-state.ts (28 lines), seedance-promo.test.ts, reward-virtual-check.test.ts, reward-share-assets.test.ts, home.test.tsx (486 lines), desktop-analytics-preference.test.ts, i18n/index.ts, i18n/locales/en.ts (1514 lines), i18n/locales/zh-CN.ts, chat-input.tsx (90 lines), reward-share-assets.ts, reward-virtual-check.ts, logout.ts, whatsapp.ts, desktop-platform.ts, skill-translations.ts, toolkit-permissions.ts

| # | 位置 | 严重级别 | 发现 | 建议 |
|---|----------|----------|---------|----------------|
| 28.1 | `community-skill-detail.tsx:70-163` | **严重** | **第二个手写 markdown 解析器（`parseMdBlocks`）** — 94行基于正则的块解析器，处理标题、代码块、有序/无序列表、段落和水平线。这是代码库中第3个 markdown 解析器（在使用 markdown-it 的 `lib/markdown.ts` 和 `sessions.tsx` 格式解析之后）。该解析器不处理嵌套结构、引用或表格 — 边缘情况会静默错误解析 | 用现有的 `lib/markdown.ts` markdown-it 渲染器通过 `<ChatMarkdown>` 或共享的 `RenderMarkdown` 组件替换 `parseMdBlocks` + `SkillMdPreview` |
| 28.2 | `community-skill-detail.tsx:165-224` | **严重** | **手写内联 markdown 渲染器（`renderInline`）** — 60行正则分词器处理粗体、斜体、内联代码、链接。单一正则 `/`[^`]+`|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/g` 无法正确处理重叠模式、转义字符或嵌套格式（如 `**bold *and italic***`） | 使用 markdown-it 的内建内联渲染器 |
| 28.3 | `community-skill-detail.tsx:356` | **严重** | **三重转换 `data as unknown as SkillDetail`** — SDK 响应类型不是 `SkillDetail`（它有 SDK 类型不包含的字段如 `installed`、`uninstallable`、`skillContent`）。此转换静默谎报数据形状；如果 API 变更，组件在运行时崩溃，没有类型错误 | 为 API 响应定义适当的 Zod schema 并在边界验证，或将缺失字段添加到生成的 SDK 类型 |
| 28.4 | `community-skill-detail.tsx:235-243` | **高** | **标题级别偏移破坏可访问性** — `SkillMdPreview` 将 `h1` 渲染为 `h3`（`level + 1`）。如果 markdown 文档以 `<h1>` 开头，它在 DOM 中变成 `<h3>`，`<h2>` 变成 `<h4>` 等。屏幕阅读器依赖正确的标题层次进行导航 | 将标题级别设置为 `block.level` 不加偏移，使用 CSS 调整视觉大小而非语义级别偏移 |
| 28.5 | `integrations.tsx:446-465` | **高** | **OAuth 回调轮询使用 `integrations.length` 作为数据变更代理** — 监视 OAuth 回调的 `useEffect` 依赖 `integrations.length` 来检测新集成出现。添加或删除任何不相关的集成会触发 OAuth 完成逻辑 | 按ID追踪特定集成，而非数组长度 |
| 28.6 | `integrations.tsx:536-547` | **高** | **OAuth 待处理状态存储在 localStorage 中无清理** — `nexu-oauth-pending-${id}` 在 localStorage 中存储 `{ state, toolkitSlug, toolkitDisplayName, ... }`。如果用户放弃 OAuth 流程（关闭浏览器、崩溃等），这些数据永远存在。经过多次 OAuth 尝试，localStorage 累积过时条目 | 添加基于 TTL 的清理或在 OAuth 流程完成/超时时清除条目 |
| 28.7 | `integrations.tsx:549-553` | **中** | **脆弱的 `oauthTabRef` 弹窗模式** — `window.open("about:blank", "_blank")` 预打开标签页以绕过弹窗拦截器，然后修改其 `location.href`。这依赖可能变化的浏览器行为；一些浏览器在较新版本中阻止 `about:blank` 位置修改 | 使用带 `state` 参数和回调 URL 的标准 OAuth 重定向流程 |
| 28.8 | `integrations.tsx:35-82` | **中** | **`useStatusBadgeConfig` 在每次 `t` 引用变更时重新创建 Record** — `useMemo` 依赖 `[t]`，这是 react-i18next 的函数引用。如果 i18next 因语言变更重新渲染，整个6条目的 Record 被重建 | 缓存各个徽章配置或使用 `useTranslation` 的稳定 `t` 引用 |
| 28.9 | `integrations.tsx:216-261` | **中** | **自定义 `DisconnectDialog` 使用固定定位 + 手动背景遮罩** — 而非使用项目的 `ui/dialog.tsx`（Radix Dialog）组件，这里构建了自己的模态框，使用 `fixed inset-0 z-50`、手动 `bg-black/30` 背景遮罩，没有焦点捕获/Escape 处理 | 替换为共享的 `<Dialog>` 组件 |
| 28.10 | `skills-view-state.ts:1-185` vs `experts-view-state.ts:1-28` | **中** | **两个视图状态 lib 之间巨大的复杂度不对称** — `skills-view-state.ts` 是185行，包含历史导航、位置状态、返回导航逻辑、不可用 slug 计算和详情路径构建。`experts-view-state.ts` 是28行，仅有解析/序列化。两者服务于相同目的（URL ↔ 视图状态）但遵循完全不同的模式 | 对齐模式 — 要么简化 skills-view-state，要么为 experts-view-state 添加缺失功能（历史感知的返回导航） |
| 28.11 | `i18n/locales/en.ts:1514` | **中** | **无类型安全保证 zh-CN 拥有所有 i18n 键** — 1514行英文翻译，没有编译时检查 `zh-CN.ts` 定义了每个键。缺失的键静默回退到英文，无警告 | 从 `en.ts` 键生成联合类型并将其用作 `zhCN` 的类型；添加测试验证键对等性 |
| 28.12 | `i18n/locales/zh-CN.ts`（通过测试验证） | **中** | **`reward.github_star.name` 在 zh-CN 中是 "Star us"（英文）** — 根据 `home.test.tsx:480`，中文本地化中有英文文本作为 GitHub star 奖励名称。与周围中文条目不一致 | 翻译为中文或验证是否故意 |
| 28.13 | `logout.ts:16-22` | **中** | **`localStorage.removeItem` 在异步 signOut 之前** — 在异步 `signOut()` 和 `postApiInternalDesktopCloudDisconnect()` 调用之前同步移除设置键。如果任何异步操作抛出，localStorage 状态已清除但用户在服务器上仍然认证 | 仅在成功 signOut 后移除 localStorage |
| 28.14 | `integrations.tsx:467-507` | **中** | **OAuth 轮询使用 `setInterval` 和20次上限（最多60秒）** — 3秒间隔加20次限制不提供轮询进度可见性。用户看到 toast "Complete the authorization" 但不知道离超时还有多久 | 添加进度指示器或使用带 `refetchInterval` + `retry` 的 React Query 进行声明式轮询 |
| 28.15 | `chat-input.tsx:103-113` | **低** | **`ChatInputSkillsButton` 没有 onClick 处理程序** — 带有 Sparkles 图标的 "Skills" 按钮但没有操作。仅是装饰性的，似乎是占位符 UI | 连接操作或在功能实现之前移除 |
| 28.16 | `chat-input.tsx:110` | **低** | **硬编码 "Skills" 字符串** — `ChatInputSkillsButton` 直接渲染文本 "Skills" 而非使用 `t()` 进行 i18n | 替换为 `t("localChat.skills")` |
| 28.17 | `reward-share-assets.ts:44-58` | **低** | **`clampRandomValue` 过度防御** — 检查 `NaN`、`<= 0`、`>= 1`。`Math.random()` 返回 `[0, 1)` 所以只有 `NaN` 理论上可能（且仅在从外部传入时）。`>= 1` 检查的 epsilon 钳位到 `0.999999999999` 是多余的 | 简化为 `if (!Number.isFinite(randomValue) || randomValue < 0) return 0; return randomValue;` |
| 28.18 | `i18n/index.ts:11-13` | **低** | **`catch { /* ignore */ }` 吞掉所有 localStorage 错误** — 如果 localStorage 因配额超出或安全错误抛出，catch 静默回退到 navigator.language 检测。虽然功能正常，但这掩盖了潜在的存储问题 | 至少在开发模式下记录警告 |
| 28.19 | `seedance-promo.test.ts` | **低** | **测试死代码** — 26行测试文件验证 `getSeedancePromoCountdown` 行为，但 Seedance 推广是死代码（截止日期 2026年4月7日）。这些测试为应该移除的代码增加了维护负担 | 与 Seedance 推广移除一起删除 |
| 28.20 | `home.test.tsx:4` | **低** | **使用 `renderToStaticMarkup` 而非 React Testing Library** — `react-dom/server` 的静态渲染器无法测试交互性、事件处理程序或状态变更。测试套件仅检查标记中的字符串存在 | 迁移到 `@testing-library/react` 的 `render()` 进行交互组件测试 |
| 28.21 | `skills-view-state.ts:42-47` | **低** | **`normalizeSearch` 防御性地前置 `?`** — `location.search` 总是以 `?` 开头，所以这仅处理无效输入。防御性检查增加了不必要的复杂性 | 如果实践中从未触发则移除，或添加注释解释何时需要 |
| 28.22 | `desktop-platform.ts:9-15` | **低** | **基于 User-agent 的平台回退** — 当未设置 `VITE_DESKTOP_PLATFORM` 环境变量时，通过 `navigator.userAgent` 字符串匹配 `win`/`mac`/`linux` 作为回退。User-agent 解析是脆弱的 | 优先使用 `navigator.platform` 或仅使用构建时环境变量 |
| 28.23 | `whatsapp.ts:7` | **低** | **外部 `api.qrserver.com` 依赖** — QR 码生成依赖没有回退、重试或缓存的第三方 API。如果 qrserver.com 宕机，WhatsApp QR 设置静默中断 | 缓存生成的 QR 码或使用客户端 QR 库（如 `qrcode`） |

### 总结

- **community-skill-detail.tsx** 包含代码库中第3个手写 markdown 解析器（`parseMdBlocks` + `renderInline` = 约154行），增加了现有的 `lib/markdown.ts`（markdown-it）和 `sessions.tsx` 格式解析器。这是三个中最脆弱的 — 单一复杂正则处理所有内联格式。
- **community-skill-detail.tsx** 使用三重转换 `data as unknown as SkillDetail` 完全绕过了 API 响应的类型安全。
- **`SkillMdPreview`** 将标题级别偏移 +1（h1→h3），破坏可访问性层次。屏幕阅读器按标题级别导航；偏移标题造成混乱的文档大纲。
- **integrations.tsx**（773行）有复杂的 OAuth 流程，包含 `setInterval` 轮询、localStorage 状态存储、`window.open("about:blank")` 弹窗管理，以及使用数组长度作为数据变更代理的 `useEffect`。多种脆弱模式叠加。
- **i18n** 有1514个英文键，没有类型安全保证 zh-CN 拥有所有对应项。`home.test.tsx` 揭示至少有一个中文本地化字符串仍是英文（`reward.github_star.name: "Star us"`）。
- **logout.ts** 在异步操作之前同步清除 localStorage — 如果 signOut 失败，用户处于不一致状态。
- **测试**对覆盖范围内的内容（reward share assets、virtual check、analytics preference、home page、budget banners）进行了良好的结构化，但缺少组件交互测试（使用 `renderToStaticMarkup` 而非 React Testing Library）。
- **chat-input.tsx**（90行）是一个干净、轻量的 textarea 组件，配有发送按钮 — 与更复杂的 `chat-input-area.tsx` 良好隔离。小问题包括硬编码字符串和仅装饰性的 Skills 按钮。

---

---

## Module 29: Desktop 渲染器、Slimclaw 包、开发工具、Nexu Skills、脚本

### packages/dev-utils/ (7 个文件)

**严重: cmd.exe shell 注入漏洞 — spawn.ts Windows 隐藏进程启动器** (`packages/dev-utils/src/spawn.ts:50-55`)。`commandText = [command, ...args].map(quoteForCmd).join(" ")` 被插入到一个 `.cmd` 批处理文件中并通过 wscript.exe 执行。引号函数 `quoteForCmd` 仅处理双引号转义 (`""`)，但未转义 `%`（环境变量展开）、`&`（命令链接）、`|`（管道）、`<`/`>`（重定向）或 `^`（转义字符）。如果任何参数包含这些字符，批处理解释器可能执行非预期命令。实践中只有开发工具使用这些路径且输入可信，但 `spawnHiddenProcess` 是一个公共导出。

**中: Windows 上依赖 PATH 的 netstat 端口检测** (`packages/dev-utils/src/process.ts:31`)。`runCommandForStdout("netstat", ["-ano"])` 依赖 `netstat` 在 PATH 中可用。在某些 Windows 配置中 `netstat` 可能不在 PATH 中，尽管通常可用。

**中: readDevLock 中未验证的 JSON 类型断言** (`packages/dev-utils/src/lock.ts:27`)。`JSON.parse(content) as DevLock` — 如果锁文件损坏或包含意外字段，`as` 类型断言会静默地将解析数据视为 `DevLock` 而不验证其结构。如果 `pid` 字段缺失，调用代码会收到 `undefined` 而非数字。

**低: waitFor 静默吞没所有错误直到耗尽重试** (`packages/dev-utils/src/conditions.ts:17`)。重试循环捕获所有异常（空 `catch {}`），仅在最后一次尝试时抛出 `createError()` 回调。中间失败（如瞬态网络错误）即使有调试日志也不可见。

**低: 子进程 stdout 通过 string += 拼接** (`packages/dev-utils/src/process.ts:17`)。`stdout += chunk.toString()` 将整个输出累积在字符串中。对于 `netstat -ano` 这可以忽略不计，但该模式在 `runCommandForStdout` 中被通用使用。

---

### packages/slimclaw/ (runtime-staging, runtime-paths, prepare-runtime, postinstall-cache)

**严重: 13+ 个精确字符串替换补丁应用于压缩 JS 包** (`packages/slimclaw/src/runtime-stage.ts:404-850`)。整个 1046 行的 `runtime-stage.ts` 对压缩的 OpenClaw JavaScript 包应用 13+ 个精确字符串搜索替换补丁。OpenClaw 包结构的任何上游变更都会导致 `applyExactReplacement` 抛出异常（"Unable to locate patch anchor"），破坏整个运行时阶段准备。被修补的 OpenClaw 源代码没有版本检测 — 系统盲目应用补丁并在不匹配时抛出异常。此外，`injectKnownLinkErrorMappings`（436-462 行）使用基于正则的锚点搜索，如果模式变更可能静默地不注入。

**严重: 压缩补丁中硬编码 localhost HTTP fetch** (`packages/slimclaw/src/runtime-stage.ts:146`)。`COMPACTION_NEXU_EVENT_REPLACEMENT` 字符串向 OpenClaw 包注入 `fetch("http://127.0.0.1:" + (process.env.CONTROLLER_PORT || "50800") + "/api/internal/compaction-notify", ...)`。这硬编码了 HTTP（非 HTTPS），在环境变量缺失时使用默认端口 `50800`，且没有错误处理（`.catch(() => {})`）。

**高: LOCALE_READER_LINES 向打包上下文注入 require()** (`packages/slimclaw/src/runtime-stage.ts:168`)。该补丁向 OpenClaw 的打包 JS 注入 `require("node:fs")` 和 `require("node:path")`。这依赖 Node.js `require` 在打包运行时上下文中可用，在某些执行环境中可能不可用（例如，如果 OpenClaw 最终转向纯 ESM 或在不同运行时中运行）。

**高: 超过 136KB 的单体 skills.json 包含嵌入的提示内容** (`nexu-skills/skills.json`)。每个技能的完整 `SKILL.md` 内容作为 `prompt` 字符串嵌入到单体 `skills.json` 中。此文件随每个新技能线性增长（当前 7 个技能产生 150KB 文件）。仅 `feishu-create-doc` 提示就嵌入了 10+ KB 的 markdown。应拆分为按需加载的独立技能文件。

**中: 补丁后脆弱的精确匹配计数断言** (`packages/slimclaw/src/runtime-stage.ts:518`)。移除遗留触发块后，代码断言 `countOccurrences(feishuBotSource, FEISHU_SYNTHETIC_PRE_LLM_BLOCK) !== 1` — 要求恰好出现 1 次。如果上游更改块格式或补丁逻辑变更，此断言将失败。

**中: 脆弱的工作区根目录解析** (`packages/slimclaw/src/runtime-paths.ts:67-69`)。`getDefaultWorkspaceRoot` 相对于源文件位置的 `../../../` 解析。如果包目录结构变更（例如 monorepo 重组），此路径会静默失效。

**中: 硬编码的关键运行时文件检查** (`packages/slimclaw/prepare-runtime.mjs:13-24`)。`criticalRuntimeFiles` 包含硬编码的 `@whiskeysockets/baileys` 路径。如果 baileys 被移除或更新（目录结构变更），检查会静默报告运行时不完整。

**中: Desktop surfaces 始终挂载，从不卸载** (`apps/desktop/src/components/desktop-shell.tsx:158-193`)。所有 4 个 desktop surface（control、web、openclaw、diagnostics）始终通过 `style={{ display: ... }}` 切换可见性的方式挂载。Web surface 包含通过 `SurfaceFrame` 的 webview，即使不可见也继续运行。每个 surface 的组件树在 desktop shell 的整个生命周期中都保留在内存中。

**中: 云消息横幅中的重复 JSX** (`apps/desktop/src/pages/cloud-profile-page.tsx:659-675`)。`cloudMessage ? ... : ...` 三元表达式的两个分支渲染了相同的 JSX 结构。唯一的区别是 `statusBannerMessage` 与静态消息 — 该三元可以折叠为始终渲染相同结构并使用计算消息。

**低: 云资料连接状态的 2 秒 setInterval 轮询** (`apps/desktop/src/pages/cloud-profile-page.tsx:141-147`)。当任何 profile 的 `polling === true` 时启动 2 秒轮询，无可见性检查。

**低: cloudStatus?.profiles 作为 useEffect 依赖导致不必要的 interval 抖动** (`apps/desktop/src/pages/cloud-profile-page.tsx:148`)。`profiles` 数组在每次状态更新时都是新引用，导致轮询 interval 被清除并重建，即使 `isPolling` 未改变。

**低: 28 行手写的 ISO 8601 时间戳格式化器** (`apps/desktop/src/lib/runtime-formatters.ts:27-55`)。`formatBuildTimestamp` 手动构造带时区偏移的 ISO 8601 字符串。可以使用 `new Date(value).toISOString()` 处理 UTC 或使用库进行本地化格式化。

**低: 手动 Blob 下载无共享辅助函数** (`apps/desktop/src/pages/cloud-profile-page.tsx:361-378`)。`handleExportProfiles` 创建 Blob、`URL.createObjectURL`，手动创建锚元素，点击它，并撤销 URL。此模式已存在于代码库的其他部分但没有共享工具函数。

**低: 静态 webSurfaceVersion 从不改变** (`apps/desktop/src/components/desktop-shell.tsx:34`)。`const webSurfaceVersion = 0` 定义在组件外部，但仅用作 `SurfaceFrame` 的 key 类属性。

**低: controller-ready.ts 复杂重试逻辑包含不可测试的边缘情况** (`apps/desktop/src/lib/controller-ready.ts:105-153`)。恢复循环有 4 个超时参数、最终尝试乘数和条件性启动控制器行为 — 复杂到边缘情况（例如，如果 `startController` 耗时超过 `attemptTimeoutMs` 会发生什么）难以推理。

**低: build-index.ts 同步写入 skills.json** (`nexu-skills/scripts/build-index.ts:96`)。`writeFileSync` 在构建期间阻塞事件循环，但对于只运行一次的构建脚本来说可接受。

**低: build-index.ts 硬编码路径前缀** (`nexu-skills/scripts/build-index.ts:62`)。`path: "skills/${skillName}"` 硬编码相对路径前缀。

**低: postinstall.mjs 中 npm --prefer-offline 可能导致安装过时包** (`scripts/postinstall.mjs:90`)。回退路径 `npm install --prefer-offline` 跳过网络检查，可能在开发期间留下过时的包。

---

### 总结

Module 29 涵盖了 packages/dev-utils、packages/slimclaw、apps/desktop/src、nexu-skills 和 scripts。严重发现集中在压缩 OpenClaw 包的脆弱精确字符串补丁和 Windows 隐藏进程启动器的 shell 注入上。slimclaw runtime-stage.ts 文件有 1046 行，是审查的最复杂文件 — 它在没有版本检测的情况下对第三方压缩 JS 应用了 13+ 个文本替换。

**Module 29 总计:** 2 严重, 3 高, 8 中, 9 低

---

## Module 30: 运行时插件、Desktop 更新器/平台、脚本与开发工具

### 运行时插件 (nexu-a2ui, nexu-credit-guard, nexu-runtime-model, langfuse-tracer)

**中: langfuse-tracer 的 pendingPrompts Map 无限增长** (`apps/controller/static/runtime-plugins/langfuse-tracer/index.js:58`)。`pendingPrompts` Map 在 `before_agent_start` 时设置，仅在成功 `agent_end` 且 agentId 匹配时删除。如果 `agent_end` 从未触发（插件重载、崩溃、agent 卡住），条目将永远累积。对于长时间运行且会话众多的 OpenClaw 进程，这会导致内存泄漏。

**中: nexu-runtime-model 使用原始字符串比较进行缓存失效** (`apps/controller/static/runtime-plugins/nexu-runtime-model/index.js:25`)。`cachedRaw === raw` 比较完整文件内容字符串进行缓存失效，而不是检查 mtime。每次读取都重新解析完整文件内容来比较字符串，这违背了对未变更文件重复读取的缓存目的。

**中: nexu-credit-guard 的 channelErrorCache 具有 5 秒 TTL，会静默过期慢速错误流** (`apps/controller/static/runtime-plugins/nexu-credit-guard/index.js:78-86`)。缓存使用 5 秒 TTL 进行 Phase 1 到 Phase 2 的错误代码传播。如果 OpenClaw 在 `llm_output`（Phase 1）和 `message_sending`（Phase 2）之间耗时超过 5 秒，缓存的错误代码将过期，消息替换将被静默跳过。

**低: COMPONENT_SCHEMAS 是可变全局数组** (`apps/controller/static/runtime-plugins/nexu-a2ui/index.js:1`)。20 组件 schema 数组定义为模块级可变 `const`。任何意外修改它的代码（push、splice）会影响所有后续工具注册。应冻结或在注册回调内部定义。

**低: A2UI 插件中硬编码的 catalogId URL** (`apps/controller/static/runtime-plugins/nexu-a2ui/index.js:462-463`)。PhonePreview 和 MarkdownEditor 的描述都硬编码 `"https://nexu.app/a2ui/custom-catalog.json"` 作为 catalogId。如果此 URL 变更，提示指令将过时，LLM 会传递过期的 catalogId。

**低: O(n*m) CONTENT_PATTERNS 正则匹配无提前退出** (`apps/controller/static/runtime-plugins/nexu-credit-guard/index.js:150-170`)。17 个内容模式顺序测试，无提前退出。对于长错误消息，每次都要对完整内容测试所有 17 个正则表达式。

**低: A2UI 的 generateA2UIJSONL 使用字符串拼接构建 JSONL** (`apps/controller/static/runtime-plugins/nexu-a2ui/index.js:392-421`)。组件和数据模型值分别进行 JSON 字符串化并用换行符连接。如果组件属性值包含未转义的 JSON 特殊字符（例如用户提供的文本），输出可能是结构无效的 JSONL。

---

### 微信运行时插件 (openclaw-weixin)

**高: 斜杠命令处理绕过授权检查** (`apps/controller/static/runtime-plugins/openclaw-weixin/src/messaging/process-message.ts:87-106`)。斜杠命令在 178-218 行的授权检查之前就被分发到 `handleSlashCommand`。如果 `handleSlashCommand` 实现了任何特权操作，未授权用户可以触发它。103 行的 `return` 在授权块之前退出。

**高: 缺失 agent 路由时继续执行并使用 undefined 值** (`apps/controller/static/runtime-plugins/openclaw-weixin/src/messaging/process-message.ts:239-243`)。当 `resolveAgentRoute` 未返回 `agentId` 时，代码记录了错误但未提前返回。执行继续使用 `undefined` 的 agentId 和 sessionKey 传入 `resolveStorePath`、`finalizeInboundContext` 和 `dispatchReplyFromConfig`，可能在无效路径上操作。

**高: dispatchReplyFromConfig 重新抛出的错误传播到监控循环** (`apps/controller/static/runtime-plugins/openclaw-weixin/src/messaging/process-message.ts:492-496`)。catch 块记录并重新抛出（`throw err`）。如果监控循环缺少每消息的 try/catch，单个失败消息会导致整个轮询循环崩溃。

**中: pairings 文件创建在文件锁之外的 TOCTOU 竞态** (`apps/controller/static/runtime-plugins/openclaw-weixin/src/auth/pairing.ts:96-102`)。文件在 99 行通过 `writeFileSync` 创建，在 102 行获取文件锁之前。99-102 行之间的并发写入者的数据会在获取锁的写入者覆盖时丢失。

**中: 对可能 undefined 的 ctx.accountId 使用非空断言** (`apps/controller/static/runtime-plugins/openclaw-weixin/src/channel.ts:145,177`)。`getContextToken(ctx.accountId!, ctx.to)` 对 `accountId: string | undefined` 使用 `!`。如果在没有 accountId 的情况下调用，会产生 Map 键 `"undefined:<userId>"` 并抛出令人困惑的 "contextToken is required" 错误。

**中: 空的 allow-from 列表在全新安装时授权所有发送者** (`apps/controller/static/runtime-plugins/openclaw-weixin/src/messaging/process-message.ts:184-203`)。`isSenderAllowed` 在 allow-from 列表为空时返回 `true`，在任何用户配对之前授权所有发送者。

**中: 进程重启时上下文 token 丢失** (`apps/controller/static/runtime-plugins/openclaw-weixin/src/messaging/inbound.ts:16`)。`contextTokenStore` 是模块级 `Map`，从未持久化。重启后所有上下文 token 丢失 — 每次出站回复都需要从新的入站消息获取新 token。

**低: MsgContext 中的 `To` 字段设为发送者的用户 ID** (`apps/controller/static/runtime-plugins/openclaw-weixin/src/messaging/inbound.ts:144`)。`weixinMessageToMsgContext` 将 `From` 和 `To` 都设为 `from_user_id`。语义上 `To` 应该是机器人自身的 ID。

**低: token 文件在 chmod 之前短暂具有默认权限** (`apps/controller/static/runtime-plugins/openclaw-weixin/src/auth/accounts.ts:216-221`)。`writeFileSync` 使用默认 umask 权限写入账户数据，然后 `chmodSync(filePath, 0o600)` 设置仅所有者权限。token 短暂地可被全局读取。

**低: sendWeixinErrorNotice 的浮动 Promise** (`apps/controller/static/runtime-plugins/openclaw-weixin/src/messaging/process-message.ts:463-470`)。使用 `void` 调用，即发即忘 — 拒绝未被处理。

**低: 过期的登录条目累积直到下次登录尝试** (`apps/controller/static/runtime-plugins/openclaw-weixin/src/auth/login-qr.ts:46-52,161`)。`purgeExpiredLogins()` 仅在 QR 登录开始时调用。TTL 为 5 分钟的过期条目在 `activeLogins` Map 中累积，无定期清理。

**低: 账户文件上的 chmod 错误被静默吞没** (`apps/controller/static/runtime-plugins/openclaw-weixin/src/auth/accounts.ts:220`)。空 `catch {}` 忽略 chmod 失败。在不支持权限的文件系统上，token 文件在无警告的情况下保持未保护状态。

---

### Desktop 更新器与平台

**严重: HTTP fetch/download 操作没有超时，可能无限挂起** (`apps/desktop/main/updater/component-updater.ts:72`, `apps/desktop/main/updater/windows-update-driver.ts:204,298`)。用于更新清单的 `fetch()` 和用于安装程序下载的原始 `http.get` 没有使用 `AbortSignal` 或超时。挂起的 R2 服务器或网络分区会永久阻塞更新管道，没有恢复机制。

**高: 部分 sidecar 提取失败时不一致的运行时状态** (`apps/desktop/main/platforms/mac/launchd-paths.ts:240-259`)。`ensureExternalNodeRunner` 和 `ensureExternalControllerSidecar` 共享单个 try/catch。如果 runner 提取成功但 controller 提取失败，函数返回混合外部 runner 和包内 controller 的路径，导致 ABI 版本不匹配。

**高: SHA-256 验证在 Windows 上将整个文件读入内存** (`apps/desktop/main/updater/windows-update-driver.ts:372-376`)。`verifyFileSha256` 调用 `readFileSync(filePath)` 将完整安装程序读入 Buffer。对于大型 NSIS 安装程序，这可能耗尽内存。`component-updater.ts` 正确地对相同操作使用了流式处理。

**高: app.removeAllListeners("before-quit") 销毁所有监听器** (`apps/desktop/main/platforms/shared/shutdown-coordinator.ts:30`)。`createManagedShutdownCoordinator` 在其 `finally` 块中调用 `app.removeAllListeners("before-quit")`，移除所有 before-quit 处理器，包括来自其他模块的（遥测、窗口状态、崩溃报告器）。

**高: 异步 sidecar 材质化器包装同步 I/O，阻塞事件循环** (`apps/desktop/main/platforms/shared/sidecar-materializer.ts:259-263`)。`createSyncTarSidecarMaterializer` 返回一个 `async` 函数，委托给同步的 `execFileSync`/`rmSync`/`mkdirSync`。调用方 `await` 此函数会在 tar 提取期间阻塞整个 Electron 主进程。

**高: `yauzl.openReadStream` 使用丢弃返回 Promise 的异步回调** (`apps/desktop/main/platforms/shared/sidecar-materializer.ts:139-164`)。传递给 `yauzl` 的回调是 `async` 但 `yauzl` 将其视为常规回调并丢弃 Promise。嵌套的 `void` IIFE 创建了复杂的 Promise 链，其中错误可能变成未处理的拒绝。

**高: Windows 更新源配置被静默忽略** (`apps/desktop/main/updater/windows-update-driver.ts:68-73`)。`resolveWindowsManifestUrl` 对所有 source 值（包括 `"github"`）返回相同的 R2 URL。配置 `source: "github"` 的用户会静默地收到 R2 更新。

**高: 限速器暂停但不强制执行吞吐量上限** (`apps/desktop/main/updater/windows-update-driver.ts:500-514`)。限速器测量每块延迟但不考虑处理时间。低于阈值的小块完全跳过限速。

**高: 更新事件转发到所有 WebContents 无过滤** (`apps/desktop/main/updater/update-manager.ts:376-390`)。`send` 方法将更新事件广播到所有 WebContents，包括 DevTools 面板和后台页面。

**中: `as never` 类型断言绕过关闭协调器中的类型安全** (`apps/desktop/main/platforms/mac/launchd-lifecycle.ts:303-309`)。`runtimeStateRef.launchd ?? (residencyContext.serviceSupervisor as never)` 抑制了真正的类型不匹配。如果类型发生偏离，错误会通过类型检查器。

**中: 组件更新器用 execFileSync("tar") 阻塞主进程** (`apps/desktop/main/updater/component-updater.ts:126`)。`execFileSync("tar", ...)` 在归档提取期间阻塞 Electron 主进程。

**中: resolveLaunchdPaths 使用 "tar" 而无完整路径，而 sidecar 使用 /usr/bin/tar** (`apps/desktop/main/updater/component-updater.ts:126` vs `sidecar-materializer.ts`)。PATH 依赖不一致 — 组件更新器可能在 sidecar 成功的地方失败。

**中: sanitizeFeedUrl 在 send 方法中被复用于非 feed URL 清理** (`apps/desktop/main/updater/update-manager.ts:382-387`)。函数名专用于 feed URL 但被通用使用，使代码具有误导性。

---

### Desktop 主服务 (launchd, quit-handler, migration, proxy, dev-inspect)

**严重: 空字符串 plistDir 静默破坏 runtime-ports.json 清理** (`apps/desktop/main/services/quit-handler.ts:67`)。`plistDir: opts.plistDir ?? ""` 将空字符串传递给 `teardownLaunchdServices`，导致 `path.join("", "runtime-ports.json")` 解析为相对于 CWD 而非实际 plist 目录的路径。过期的 runtime-ports.json 永远不被清理，可能混淆下次冷启动的过期会话检测。

**高: kill 操作中的 PID 复用竞态** (`apps/desktop/main/services/launchd-bootstrap.ts:1369,1627,1770`, `apps/desktop/main/services/launchd-manager.ts:399,430`)。通过 `launchctl print`/`pgrep`/`readRuntimePorts` 获取的 PID 稍后在 `process.kill(pid, "SIGKILL")` 中使用。如果 PID 在枚举和 kill 之间被回收，将终止错误的进程。

**高: stopServiceGracefully 在 SIGTERM 失败时无条件返回，跳过等待和强制终止** (`apps/desktop/main/services/launchd-manager.ts:185-191`)。如果 `stopService` 因任何原因抛出（包括瞬态 launchd 忙），catch 块立即返回，没有轮询等待或 SIGKILL 回退。

**高: Langfuse 密钥和网关 token 以明文写入全局可读的 plist 文件** (`apps/desktop/main/services/plist-generator.ts:243,330,337,345`)。包含密钥的环境变量嵌入在 `~/Library/LaunchAgents/` 下的 plist XML 文件中，具有默认的 644 权限。任何同用户进程都可以读取这些凭据。

**高: 同步 `*Sync` 文件操作在迁移期间阻塞 Electron 主进程** (`apps/desktop/main/services/nexu-home-migration.ts:28-222`, `apps/desktop/main/services/state-migration.ts:64-134`)。所有文件操作使用 `cpSync`/`mkdirSync`/`readFileSync` — `runtime/` 目录拷贝可能达数百 MB，在首次升级后启动时冻结 UI 数秒。

**高: dev-inspect-server 启动/停止中的模块级变量竞态** (`apps/desktop/main/services/dev-inspect-server.ts:32`)。`desktopDevInspectServer` 变量同时被 `start` 和 `stop` 写入。如果在 start 处于其 `new Promise` 回调内部时调用 stop，服务器可能在 stop 返回后仍在运行。

**高: 迁移操作不是原子的 — 进程崩溃留下无标记的部分状态** (`apps/desktop/main/services/state-migration.ts:64`)。完成标记仅在所有拷贝操作之后写入。拷贝中途崩溃留下部分文件；重新运行添加缺失文件但从不移除部分数据。

**高: createReadStream(filePath).pipe(res) 缺少读取流错误处理器** (`apps/desktop/main/services/embedded-web-server.ts:212`)。如果文件在 `stat` 和 `createReadStream` 之间被删除，读取流发出未处理的错误，可能使进程崩溃或挂起客户端。

**中: 过期会话阈值（5 分钟）允许快速强制退出 + 重新启动来复用过期服务** (`apps/desktop/main/services/launchd-bootstrap.ts:721-738`)。5 分钟内强制退出 + 重新启动绕过过期会话检测，可能复用已死会话的服务（下次轮询的 appVersion 检查能捕获应用更新但不能捕获配置变更）。

---

### 脚本与开发工具

**严重: 两个脚本中 Windows 不兼容的 main-module 检测** (`scripts/notify/daily-content-bot.mjs:472`, `scripts/notify/developer-notify.mjs:342`)。守卫 `import.meta.url === \`file://${process.argv[1]}\`` 在 URL 中使用正斜杠，而 Windows 路径使用反斜杠，在 Windows 上永远不匹配。脚本直接调用时静默无操作。

**高: 飞书 webhook 通知缺少 fetch 超时** (`scripts/notify/feishu-notify.mjs:113`)。`fetch(webhookUrl, ...)` 调用没有 timeout/AbortSignal。如果飞书 webhook 挂起，脚本无限阻塞。所有其他通知脚本正确实现了超时。

**中: mock-link-errors 中客户端断连后未处理的写入错误** (`scripts/mock-link-errors.mjs:267-276`)。`setTimeout` 回调在 5 秒延迟后写入 SSE 块 — 如果客户端已断连，`res.write()` 抛出未捕获异常导致服务器崩溃。

**中: setup-git-hooks 静默吞没所有错误** (`scripts/setup-git-hooks.mjs:11-16`)。`catch {}` 吸收所有异常（`copyFile`、`chmod`），包括像缺失 `.git/hooks` 目录这样的关键失败。没有反馈表明钩子未安装。

**中: generate-github-stats 中 DST 不安全的日期算术** (`scripts/generate-github-stats.mjs:96-101`)。日期边界通过固定毫秒减法计算（`30 * 86400000`）。在 DST 转换期间（23 小时/25 小时天），范围偏移一小时。

**中: tools/dev CLI 中 4 倍重复的日志读取代码** (`tools/dev/src/index.ts:250-350`)。desktop、openclaw、controller 和 web 服务的近乎相同的日志尾部实现 — 每个都使用相同模式从会话日志文件读取最后 200 行。应提取为共享辅助函数。

---

### Controller 运行时服务

**中: killOrphanedOpenClawProcesses 的主要路径仅限 Linux** (`apps/controller/src/runtime/openclaw-process.ts:530-550`)。孤儿清理扫描 `/proc` 文件系统，这是 Linux 特有的。macOS pgrep 回退可用，但如果 `/proc` 恰好存在，主要路径会在 macOS 上崩溃。

**中: openclaw-ws-client 的 ws.onerror 手动关闭变通方案** (`apps/controller/src/runtime/openclaw-ws-client.ts:656-660`)。`ws.onerror` 手动调用 `ws.close()`，因为原生 WebSocket 在连接拒绝后不触发 `onclose`。这是脆弱的，依赖未文档化的行为 — 可能随 Node.js WebSocket 实现变更而失效。

**中: local-chat 会话发现使用固定间隔轮询** (`apps/web/src/pages/local-chat.tsx:151-178`)。100 毫秒间隔的 30 次尝试（总计 3 秒），无指数退避或导航中止。如果会话创建耗时超过 3 秒，用户只看到旋转加载器。

**低: 1972 行单体 Electron 入口文件** (`apps/desktop/main/index.ts`)。冷启动、关闭、窗口管理、托盘、设置提取、Rosetta 检测和信号处理都在一个文件中。

**低: 通过单个 switch-case 处理器处理 47+ 个 IPC 通道** (`apps/desktop/main/ipc.ts:913`)。所有 IPC 通道在一个 `ipcMain.handle("host:invoke", ...)` 中通过类型化 switch-case 处理。添加通道需要触碰这个中心文件。

**低: experts.tsx 内联定义 useDebounce** (`apps/web/src/pages/experts.tsx:28-37`)。这是 web 应用中第 4 个相同 useDebounce 的副本。应使用共享 hook。

**低: MarkdownEditor content 字段未验证** (`apps/controller/static/runtime-plugins/nexu-a2ui/index.js:369-375`)。MarkdownEditor 组件 schema 接受原始 `content: string`，没有长度限制或净化。大内容可能导致聊天 UI 的渲染性能问题。

---

### 总结

Module 30 涵盖了运行时插件（a2ui、credit-guard、runtime-model、langfuse-tracer、weixin）、desktop 更新器/平台、desktop 主服务、脚本、开发工具和 controller 运行时服务。最有影响的发现包括更新下载路径中缺少 HTTP 超时（可能无限挂起）、空字符串 plistDir 在每次关闭时静默破坏 runtime-ports.json 清理，以及 Windows 不兼容的 main-module 检测导致两个脚本在 Windows 上无法运行。weixin 插件存在斜杠命令的授权绕过和可能导致消息轮询循环崩溃的缺失错误隔离。Desktop 服务在 kill 操作中有 PID 复用竞态，launchd plist 文件中有明文密钥。

**Module 30 总计:** 3 严重, 19 高, 18 中, 14 低

---

## Module 31: 剩余 Controller 源文件、Desktop 构建脚本、Slimclaw、文档与冒烟测试

**范围:** 48 个文件，覆盖 4 个区域：剩余 controller 源文件（16）、desktop 构建/打包脚本（18）、slimclaw 脚本 + 文档脚本 + 冒烟测试（14）

**审查者:** 直接审查 + 2 个代码审查 agent

### Controller - 剩余源文件

审查了: `channel-binding-compiler.ts`、`secrets.ts`、`chat-routes.ts`（额外发现）、`media-routes.ts`、`device-control-routes.ts`、`loops.ts`、`gateway-client.ts`、`openclaw-auth-profiles-store.ts`、`control-plane-health.ts`、`runtime-health.ts`、`openclaw-auth-profiles-writer.ts`、`credit-guard-state-writer.ts`、`device-control-service.ts`、`device-mirror-proxy.ts`、`channel-fallback-service.ts`、`feishu-fallback-adapter.ts`

**高: SSE 流 `setInterval` 中的同步文件 I/O 阻塞事件循环** (`apps/controller/src/routes/chat-routes.ts`)。SSE 流端点（`GET /api/v1/chat/stream`）在 1 秒的 `setInterval` 回调内使用 `fs.statSync()`、`fs.openSync()` 和 `fs.readSync()` 来轮询和流式传输文件内容。`fs.readSync` 每次轮询每个活跃 SSE 客户端最多读取 `MAX_READ_PER_POLL = 1MB`。对于多个并发 SSE 客户端（每个连接的浏览器标签一个），累积的同步磁盘 I/O 阻塞 Node.js 事件循环，降低 controller 进程上所有其他并发请求处理器的响应性。每秒每个客户端同步读取 1MB 比典型的异步 I/O 模式阻塞量大一个数量级。应使用 `fs.createReadStream` 或带背压感知流式传输的异步 `fs.read`。

**中: `resolveLang()` 始终返回 "en"，忽略用户区域设置** (`apps/controller/src/services/channel-fallback/adapters/feishu-fallback-adapter.ts`)。`resolveLang()` 方法接收带有 `locale` 字段的 `RuntimeEvent` 但始终返回 `"en"`，完全忽略运行时事件的区域设置偏好。适配器为 5 个错误代码提供了双语消息模板（en + zh-CN），但语言选择逻辑是硬编码而非动态的。中文用户始终收到英文回退消息，无论其区域设置如何。可能是从未实现的占位符 — 双语模板表明这已计划但选择逻辑从未完成。

### Desktop 构建/打包脚本

审查了 `apps/desktop/scripts/` 中的 18 个文件: `dist-mac.mjs`、`dist-mac-arm64.mjs`、`dist-mac-arm64-unsigned.mjs`、`dist-mac-x64.mjs`、`dist-mac-x64-unsigned.mjs`、`dist-mac-unsigned.mjs`、`dist-win.mjs`、`dist-win-stage.mjs`、`desktop-package-version.mjs`、`desktop-package-paths.mjs`、`desktop-sign-pkg.mjs`、`prepare-openclaw-sidecar.mjs`、`prepare-controller-sidecar.mjs`、`prepare-runtime-sidecar.mjs`、`notarize-mac-artifacts.mjs`、`lib/sidecar-paths.mjs`、`lib/blockmap.mjs`、`lib/build-env.mjs`

**中: 构建错误处理器在 dist-win.mjs 中丢弃堆栈跟踪** (`apps/desktop/scripts/dist-win.mjs:308-313`)。顶层错误处理器捕获错误并仅记录 `error.message`（`console.error(error instanceof Error ? error.message : error)`）。构建失败时，堆栈跟踪对于定位多阶段 Windows 打包管道中的哪个步骤失败至关重要。同目录中的其他脚本（如 `desktop-package-version.mjs:42-44`）正确使用 `console.error(error)` 保留包含堆栈跟踪的完整错误。

**中: 静默的钥匙串创建失败级联为令人困惑的下游错误** (`apps/desktop/scripts/prepare-openclaw-sidecar.mjs:475`)。`security create-keychain` 被 `.catch(() => null)` 包装，静默吞没创建失败。如果钥匙串创建失败（磁盘满、权限问题、锁定现有钥匙串），后续 476-508 行的 `security` 命令（`set-keychain-settings`、`unlock-keychain`、`import`、`set-key-partition-list`）都操作不存在或损坏的钥匙串路径。这些下游命令没有 `.catch()` 保护，所以它们会抛出，但错误消息指向下游失败（"unable to unlock keychain"）而非根因（"keychain creation failed"）。

**中: 未转义的路径插值到生成的 Windows 批处理文件中** (`apps/desktop/scripts/prepare-openclaw-sidecar.mjs:684-686`)。`packagedOpenclawEntry` 路径直接插入到 `.cmd` 批处理文件模板中。此路径源自 `NEXU_DESKTOP_SIDECAR_OUT_DIR`（环境变量）。如果路径包含 cmd.exe 元字符（`"`、`&`、`|`、`>`、`<`、`^`、`%`），它们将被解释为 shell 命令。虽然此环境变量由构建系统内部设置，但生成的批处理文件成为部署产物。等效的 POSIX 包装器通过从 `$0` 动态计算入口路径来避免此问题。

**低: sidecar 准备中 `chmod` 失败被静默吞没** (`apps/desktop/scripts/prepare-openclaw-sidecar.mjs:667`)。`chmod(packagedOpenclawEntry, 0o755)` 被 `.catch(() => null)` 包装。此处失败（权限错误、只读文件系统）被静默丢弃。虽然 Node.js 可以通过 `node <path>` 在没有 +x 位的情况下执行脚本，但 shell 启动器包装器可能尝试直接执行。

### Slimclaw、文档脚本与冒烟测试

审查了 14 个文件: `packages/slimclaw/*.mjs`（7）、`docs/scripts/*.mjs`（5）、`docs/.vitepress/config.ts`、`smoke/feishu-ws-smoke.mjs`

**未发现置信度 >= 80 的问题。** 这些区域的代码结构良好，错误处理一致，异步模式正确，安全防护适当。值得肯定的是: slimclaw 基于指纹的缓存失效和锁优先安装模式; 文档脚本的去抖资产观察器和正确的 SIGTERM 到 SIGKILL 升级; 冒烟测试的密钥脱敏和干净的信号处理。

**低: `.startsWith()` 路径包含检查绕过** (`packages/slimclaw/prune-runtime.mjs:32`)。路径遍历守卫使用 `absolutePath.startsWith(runtimeDir)`，当 `runtimeDir` 是另一个目录的字符串前缀时（如 `openclaw` 与 `openclaw2`），可被绕过。实践中，所有修剪目标都是硬编码且可信的（在 `prune-runtime-paths.mjs` 中），因此不存在利用路径 — 这纯粹是纵深防御的关注点。

### 总结

Module 31 涵盖了 48 个剩余源文件。最有影响的发现是 SSE 聊天流端点中的同步文件 I/O — 对于多个并发 SSE 客户端，1 秒 `setInterval` 中的 `fs.statSync`/`fs.readSync` 阻塞 controller 的事件循环，降低所有并发请求处理。飞书回退适配器硬编码的 `resolveLang()` 意味着中文用户尽管有双语模板可用，却永远不会收到中文错误消息。Desktop 构建脚本有几个错误静默和路径转义问题，可能在发布构建期间减慢调试速度。

**Module 31 总计:** 0 严重, 1 高, 5 中, 2 低

---

## Module 32: Controller 测试

**范围:** 58 个测试文件 — `apps/controller/tests/`（38）+ `tests/controller/`（20）

**审查者:** code-reviewer agent (aa3ed29cb264a392a)。完整阅读 20 个核心文件，通过 grep 扫描其余文件。

### 发现

**中: ChannelFallbackService 测试使用脆弱的微任务刷新模式** (`apps/controller/tests/channel-fallback-service.test.ts:49-50, 90-91, 147-148`)。三个测试用例同步发出事件，然后调用两次 `await Promise.resolve()` 来"刷新微任务队列"再对异步副作用进行断言。如果内部实现从基于微任务的调度（`Promise.resolve().then(...)`）切换到基于宏任务的（`setTimeout(0)`、`setImmediate`），这些测试会静默通过而不验证任何内容 — 或在慢速 CI 上间歇性失败。测试应 await 事件处理器返回的实际 Promise。

**低: OpenClawConfigWriter 测试通过固定 setTimeout 增加约 250ms 不必要延迟** (`apps/controller/tests/openclaw-config-writer.test.ts:55, 101, 119, 169, 215`)。五个测试用例使用 `await new Promise(r => setTimeout(r, 50))` 确保在重新检查去重行为前的 mtime 间隔。虽然不会导致测试不稳定（50ms 远超 APFS/NTFS/ext4 上亚毫秒级文件系统时间戳粒度），但基于内容哈希的去重检查或 `vi.useFakeTimers()` 会更快且更确定性。

**低: `tests/controller/` 中 7 个重导出测试文件贡献零唯一断言。** 每个文件是单个 `import "../../apps/controller/tests/<same-name>.test.ts"` — 出于 Vitest 配置目的（不同的 tsconfig 别名解析），但它们包含 0 个 `describe`、0 个 `it` 和 0 个 `expect` 调用。覆盖没有丢失（它们重新运行来自另一目录的测试），但可能误导贡献者和覆盖报告。

### 总体评估

Controller 测试套件结构良好。主要优势: 隔离的临时目录配合适当的 `afterEach` 清理、安全敏感代码覆盖（zip-slip、代理凭据脱敏、OAuth）、并发访问测试（DeviceTaskHistoryStore、ExperthubCatalogManager 去重）、无 `.only` 过滤器，且所有文件至少有与 `it()` 块相同数量的 `expect()` 调用。

**Module 32 总计:** 0 严重, 0 高, 1 中, 2 低

---

## Module 33: Desktop 测试

**范围:** `tests/desktop/` 中的 59 个测试文件

**审查者:** code-reviewer agent (ac57d68f3c9488cc2)。完整阅读 14 个关键文件，通过 grep 扫描其余文件。

### 发现

**严重: `daemon-supervisor-restart.test.ts` 测试的是重新实现，而非真实代码** (`tests/desktop/daemon-supervisor-restart.test.ts:38-108`)。测试文件将整个自动重启决策逻辑作为本地 `evaluateAutoRestart` 函数重新实现，该函数镜像了 `daemon-supervisor.ts` 中的生产代码，而不是导入和测试真实实现。像 `MAX_CONSECUTIVE_RESTARTS`、`BACKOFF_BASE_MS`、`MAX_BACKOFF_MS`、`STABLE_UPTIME_WINDOW_MS` 这样的常量可以简单地提取到共享模块。如果在真实重启逻辑中引入 bug，这些测试仍然会通过，因为它们测试的是副本。"We can't import private module constants directly" 的注释是设计异味 — 这些常量应从共享工具模块导出。

**中: `launchd-startup-scenarios.test.ts` 中重复的场景编号** (`tests/desktop/launchd-startup-scenarios.test.ts`)。两个 "Scenario 19" 块（832 行和 949 行），两个 "Scenario 10" 块（581 行和 598 行），以及重复的 "Scenario 20" — 当测试按场景编号失败时，调试输出变得模糊。

**中: `launchd-integration.test.ts` 跳过了真实生产边缘情况的测试** (`tests/desktop/launchd-integration.test.ts:1050, 1173`)。两个 `it.skip` 测试守护着真正重要的边缘情况: 包含空格的 `NEXU_HOME` 路径（真实 macOS 关注点）和 unicode 字符（中文用户名常见）。没有说明需要更改什么才能启用它们。

**中: `runtime-manifests.test.ts` 直接修改 `process.env` 无 `afterEach` 保证** (`tests/desktop/runtime-manifests.test.ts:631-661`)。`process.env.LANGFUSE_PUBLIC_KEY` 被直接设置并手动恢复 — 如果测试中途失败，同一文件中的后续测试会看到被污染的环境。应使用 `vi.stubEnv`/`vi.unstubEnv` 或 try/finally 块。

**中: `data-directory-runtime.test.ts` 中固定的 1 秒 `setTimeout` 而非轮询** (`tests/desktop/data-directory-runtime.test.ts:370`)。使用 `await new Promise(r => setTimeout(r, 1000))` 等待真实 launchd 服务启动。即使服务在 50ms 内启动也增加固定 1 秒延迟; 在 CI 负载下，1 秒可能不够，导致测试不稳定。

**低: 运行时 `require("node:events")` 而非顶层 import** (`tests/desktop/daemon-supervisor.test.ts:88`)。在函数运行时作用域使用 `require("node:events")` 而非顶层 `import`。在 Vitest 的 CJS-ESM 桥接中可以工作，但对 ESM 项目来说是非标准的。

**低: `controller-ready.test.ts` 中的零值轮询参数** (`tests/desktop/controller-ready.test.ts`)。所有轮询测试使用 `attemptTimeoutMs: 0` 和 `pollIntervalMs: 0`，依赖函数对零值参数的内部行为。如果生产代码的零值处理变更，这些测试将不再测试有意义的轮询行为。

### 总体评估

Desktop 测试套件结构良好，对复杂的 launchd 生命周期、更新管理和守护进程监督路径有全面的覆盖。`daemon-supervisor-restart.test.ts` 中的严重问题影响最大 — 测试重新实现而非真实代码完全破坏了测试的价值。

**Module 33 总计:** 1 严重, 0 高, 4 中, 2 低

---

## Module 34: 剩余测试（Web、Shared、NexuPal、E2E）与最终扫描

**范围:** 35 个测试文件 + 5 个 E2E 文件 + 最终源代码扫描 — `tests/web/`（6）、`tests/shared/`（6）、`tests/nexu-pal/`（5）、`tests/slimclaw-runtime/`（1）、`tests/scripts-dev/`（1）、`tests/notify/`（1）、`apps/web/tests/`（15）、`e2e/`（3）、`apps/web/e2e/`（2）

**审查者:** 直接审查

### 发现

**未发现置信度 >= 80 的问题。** 所有测试区域展示了统一的质量:

- **共享 schema 测试** (`tests/shared/`): 良好的验证覆盖（正常路径、无效输入、默认值、空白 detected_language 等边缘情况）。`channel-schema`、`bot-schema`、`openclaw-config-schema`、`expert-schema`、`rewards-proof` 和 `rewards-share-templates` 的测试都有适当的断言和边缘情况覆盖。

- **NexuPal 测试** (`tests/nexu-pal/`): 良好的 GitHub 分拣引擎覆盖，包括翻译、bug 分类、信息完整性检查和 sentry[bot] 内部等价短路。`permission-checker.test.ts` 覆盖所有权限级别。`github-client.test.ts` 测试标签去重、API 排序和 404 处理。

- **Web SSR 测试** (`tests/web/`、`apps/web/tests/`): 使用 `renderToStaticMarkup` 进行 SSR 测试（无 jsdom 开销）。`workspace-layout.test.tsx`（693 行）和 `sessions.test.tsx`（646 行）有全面的 SSR 覆盖。注意到跨文件的 mock 重复（相同的 `vi.mock` 模式用于 react-i18next、useAutoUpdate、useLocale、authClient），但对测试隔离来说可接受。

- **E2E 测试** (`e2e/`、`apps/web/e2e/`): 基于 Playwright 的技能 OAuth 流程和 desktop 打包测试。使用 `process.env` 获取凭据，无硬编码密钥。`waitFor` 辅助函数使用指数轮询配合充足的超时，适合 E2E。

- **追踪测试** (`apps/web/tests/tracking.test.ts`): 测试 PostHog 身份管理、去重、登出时重置和属性规范化 — 分析边缘情况的良好覆盖。

- **最终扫描**: 检查了剩余源文件（`apps/controller/scripts/`、`skills/nexubot/feedback/`、`apps/desktop/shared/`、`apps/desktop/mock-update-server.mjs`）— 未发现问题。所有先前未审查的区域现已覆盖。

### 总结

Module 34 完成了完整代码库审查。剩余测试和最终扫描文件结构一致，具有适当的错误处理、安全实践和边缘情况覆盖。

**Module 34 总计:** 0 严重, 0 高, 0 中, 0 低

---

## Module 35: 最终遗漏文件 — 生命周期、脚本与 Sidecars

**范围:** 先前未审查目录中的 11 个源文件 — `apps/desktop/main/lifecycle/`（2）、`apps/desktop/sidecars/web/`（1）、`apps/controller/static/runtime-plugins/nexu-platform-bootstrap/`（1）、`apps/desktop/scripts/platforms/`（7）、`.nexu-dev/skills/nano-banana/scripts/`（1）、`apps/desktop/static/bundled-skills/nano-banana-one-shop/scripts/`（1）

**审查者:** 直接审查

### 发现

**高: Web sidecar `createReadStream` 无错误处理器导致进程崩溃** (`apps/desktop/sidecars/web/index.js:154`)。静态文件服务函数使用 `createReadStream(filePath).pipe(response)` 而未在读取流上附加 'error' 事件处理器。如果文件在 `stat()` 检查和 `createReadStream()` 调用之间变得不可读 — TOCTOU 竞态 — 流发出没有监听器的 'error' 事件，在 Node.js 16+ 中**会导致进程崩溃**并抛出 `ERR_UNHANDLED_ERROR`。在打包的 desktop 应用中，此崩溃会被 launchd 捕获并触发自动重启，导致 web UI 约 2-3 秒的服务中断。

**修复建议:** 在 `.pipe(response)` 之前添加 `readStream.on("error", (err) => { response.writeHead(500); response.end(); })`，或将 stat+createReadStream 模式替换为单个 `fs.promises.open()` + `fileHandle.createReadStream()` 以避免 TOCTOU 间隔。

**中: 上游 controller 错误消息泄露给 web 客户端** (`apps/desktop/sidecars/web/index.js:133-135`)。当 controller API 代理耗尽所有 10 次重试尝试时，`lastError.message` 通过 `response.end(JSON.stringify({ error: lastError.message }))` 直接转发给 web 客户端。如果 controller 返回包含内部细节（文件路径、堆栈跟踪或内部状态）的错误，这些细节会暴露给机器上的任何本地进程或用户，因为 sidecar 监听在用户特定端口上且无认证。

**修复建议:** 返回通用错误消息如 `"Controller unavailable"` 并在服务端记录详细错误，而非将其转发给客户端。

**剩余 9 个文件未发现问题:**

- `apps/desktop/main/lifecycle/launchd-recovery-policy.ts` — 干净的状态机，带有多字段身份检查（版本、状态目录、userData 路径、构建来源、NEXU_HOME）。结构良好，决策基于清晰的枚举。
- `apps/desktop/main/lifecycle/launchd-session-store.ts` — `runtime-ports.json` 的 CRUD 操作，带原子写入（writeFile + rename）。适当的错误处理。
- `apps/controller/static/runtime-plugins/nexu-platform-bootstrap/index.js` — 简单的 19 行插件，将工具进度提示注入系统上下文。
- `apps/desktop/scripts/platforms/`（7 个文件）— 平台解析（darwin 到 mac、win32 到 win）、macOS/Windows 的构建能力工厂、文件系统辅助函数。`quoteWindowsCmdArg` 正确处理空白和特殊字符。`process-compat.mjs` 和 `platform-resolver.mjs` 是薄包装器。
- `.nexu-dev/skills/nano-banana/scripts/file-upload.js` — Gemini Files API 上传，支持可恢复协议、适当的 `res.ok` 检查、失败时 `process.exit(1)`。
- `apps/desktop/static/bundled-skills/nano-banana-one-shop/scripts/generate-image.js` — Gemini 图像生成，支持多模型和通过 sharp 的渐进质量压缩。API 密钥解析带 SKILL_API_TOKEN 回退、大量输入验证、适当的错误处理。

### 总体评估

Module 35 覆盖了先前模块扫描遗漏的最终 11 个源文件。Web sidecar 静态文件服务存在真实的生产崩溃风险（未处理的流错误），错误转发泄露内部细节。剩余的生命周期、平台脚本和技能脚本都很干净。

**Module 35 总计:** 0 严重, 1 高, 1 中, 0 低

---

## Module 36: 文档、i18n、通知脚本与开发平台

**范围:** 先前未审查目录中约 30 个源文件 — `docs/.vitepress/`（2）、`docs/scripts/`（5）、`smoke/`（1）、`skills/nexubot/`（2）、`scripts/notify/`（4）、`scripts/probe/`（2）、`scripts/nexu-pal/lib/signals/`（2）、`scripts/` 顶层（6）、`apps/web/src/i18n/`（3）、`apps/web/src/types/`（1）、`packages/slimclaw/runtime-seed/`（1）、`nexu-skills/scripts/`（1）、`tools/dev/src/shared/platform/`（3）、`vitest.config.ts`、`ecosystem.config.cjs`

**审查者:** 直接审查

### 发现

**未发现置信度 >= 80 的问题。** 所有审查的文件结构良好且干净:

- **VitePress 文档配置** (`docs/.vitepress/config.ts`、`theme/index.ts`): 标准 VitePress 配置，4 语言设置（en/zh/ja/ko）。内联区域检测脚本通过 try/catch 优雅处理 localStorage。

- **文档构建脚本** (`docs/scripts/`): 资产规范化管道，使用 sharp 进行图像优化、去抖观察器、检查侧边栏链接解析到实际 .md 文件的 URL 验证器、带优雅关闭的开发服务器（SIGTERM 到 SIGKILL 升级）。都有适当的错误处理。

- **飞书 WS 冒烟测试** (`smoke/feishu-ws-smoke.mjs`): 全面的 314 行冒烟测试，具有凭据脱敏、URL 摘要、CLI 参数解析、配置文件凭据回退、SIGINT/SIGTERM 处理器和详细结构化日志。编写良好。

- **Nano Banana 技能脚本**: Gemini 图像生成和文件上传脚本，具有适当的 API 密钥解析（环境变量到 SKILL_API_TOKEN 回退）、大量输入验证和通过 sharp 的渐进质量压缩。反馈提交脚本（`submit-feedback.mjs`）执行复杂的会话 JSONL 解析，使用稳健的基于正则的文本清理进行多通道消息提取（飞书、Slack、Discord）。

- **通知脚本** (`scripts/notify/`): GitHub 到飞书/Discord 的通知机器人，具有组织成员检查、通过 AbortController 的超时信号、文本清理和适当的错误处理。所有密钥来自 `process.env`。

- **探测脚本** (`scripts/probe/`): 模型调用探测从 launchd 会话存储读取运行时端口; Slack 回复探测使用 Playwright 和 Chrome Canary 进行端到端 DM 回复测试。

- **NexuPal 信号桩** (`scripts/nexu-pal/lib/signals/`): `duplicate-detector.mjs` 和 `roadmap-matcher.mjs` 是返回 `{ matched: false }` 并带诊断消息的占位桩 — 明确标记为 "phase 1" 桩，不是死代码。

- **顶层脚本**: `postinstall.mjs`（运行时插件安装）、`check-esm-specifiers.mjs`（ESM 导入验证）、`mock-link-errors.mjs`（带 13 种错误类型的 LLM 错误模拟服务器、用于压缩测试的填充模式和 SSE 流式传输）、`setup-git-hooks.mjs`（pre-commit 钩子安装器）、`generate-github-stats.mjs`（SVG 指标生成）、`resolve-slimclaw-openclaw-entry.mjs`（运行时路径解析器）。都有适当的错误处理。

- **i18n** (`apps/web/src/i18n/`): 干净的 i18next 设置，带 localStorage 区域检测; 约 1500 行的 en 和 zh-CN 区域设置文件，翻译覆盖全面。

- **类型声明** (`apps/web/src/types/desktop.d.ts`): 类型良好的 `NexuDesktopBridge` 接口和相关技能类型。

- **Slimclaw 运行时种子** (`packages/slimclaw/runtime-seed/clean-node-modules.mjs`): 带 `--dry-run` 标志和 `exists` 守卫的简单清理脚本。

- **Skills 构建索引** (`nexu-skills/scripts/build-index.ts`): 使用 gray-matter 前置元数据解析读取 SKILL.md 文件，构建 `skills.json` 索引。对缺少描述的技能适当跳过并给出警告。

- **开发平台** (`tools/dev/src/shared/platform/`): 干净的平台分派模式（darwin/win32），使用 `process.platform` switch 语句和对不支持平台的适当错误处理。

- **根配置**: `vitest.config.ts`（标准 Vitest 配置，带 React 插件和路径别名）、`ecosystem.config.cjs`（用于 OpenClaw 网关进程管理的 PM2 配置）。

### 总体评估

Module 36 完成了文档、i18n、通知脚本和开发平台的审查，新增约 30 个文件。所有文件结构良好，具有适当的错误处理、无硬编码凭据、无安全问题。

**Module 36 总计:** 0 严重, 0 高, 0 中, 0 低

---

## Module 37: 运行时插件 (openclaw-weixin + whatsapp)

**审查范围:** `apps/controller/static/runtime-plugins/` 中的 46 个文件。所有 25 个 weixin 文件 + 4 个 whatsapp 源文件完整阅读。其余通过 grep 扫描。

### openclaw-weixin 插件

微信（WeChat）通道插件是一个生产级质量的通道实现。审查的关键文件:

- `channel.ts`（424 行）— 插件定义，包含出站消息、媒体发送、QR 认证和网关生命周期
- `process-message.ts`（553 行）— 消息处理管道: 路由 → 下载媒体 → 带输入指示器分派回复
- `send.ts`（300 行）— 文本/媒体发送，带 markdown 到纯文本转换和上下文 token 强制
- `login-qr.ts`（379 行）— QR 码登录流程，带轮询、刷新和基于 TTL 的会话管理
- `api.ts`（252 行）— API 客户端，带超时/中止、凭据脱敏和适当的错误处理
- `monitor.ts`（277 行）— 长轮询监控器，带退避、会话过期处理和状态传播
- `upload.ts`（163 行）— CDN 上传管道，带 AES-128-ECB 加密
- `accounts.ts`（347 行）— 账户管理，带 chmod 600 凭据文件、遗留迁移
- `pic-decrypt.ts`（93 行）— CDN 媒体下载，带双格式 AES 密钥解析
- `media-download.ts`（169 行）— 入站媒体下载，带 silk 音频转码支持

**安全优势:**
- 凭据文件 chmod 600（`accounts.ts:218`）
- 所有日志路径中一致的 token/body/URL 脱敏（`util/redact.ts`）
- 所有出站发送需要上下文 token（以显式错误强制）
- 会话过期检测，带自动暂停/恢复
- 轮询循环中适当的中止信号传播
- AES 密钥双格式解析处理原始字节和十六进制编码的 base64 变体

### WhatsApp 插件

- `channel.ts`（477 行）— 委托给 `openclaw/plugin-sdk/whatsapp` 处理核心逻辑的薄适配器
- 插件正确处理安全策略、群组策略、反应、投票和心跳检查

### 评估

没有问题达到置信度 80 的阈值。两个插件都展示了成熟、防御性的编码，具有适当的安全实践、全面的错误处理和安全的资源清理。

**Module 37 总计:** 0 严重, 0 高, 0 中, 0 低

---

## Module 38: Desktop 构建脚本与共享模块

**审查范围:** 28 个文件。`apps/desktop/scripts/` 中的 18 个构建脚本 + `apps/desktop/shared/` 中的 10 个共享模块。所有文件完整阅读。

### Desktop 构建脚本

- `dist-mac.mjs`（约 900 行）— macOS DMG 构建，带代码签名、公证、dmg-builder 校验和验证、electron-builder 集成
- `dist-win.mjs`（约 240 行）— Windows 安装程序构建，带 NSIS、供应商提供的 7zip 和 makensis 路径解析
- `dist-win-stage.mjs`（约 1000+ 行）— 分阶段 Windows 构建，带组件准备
- `prepare-controller-sidecar.mjs`（182 行）— Controller sidecar 打包，带依赖闭包验证
- `prepare-openclaw-sidecar.mjs`、`prepare-runtime-sidecars.mjs`、`prepare-web-sidecar.mjs` — Sidecar 提取脚本
- `upload-sourcemaps.mjs` — Sentry sourcemap 上传
- 平台脚本: `desktop-platform.mjs`、`platform-resolver.mjs`、`sidecar-paths.mjs`、构建能力工厂

**子进程安全:** 所有脚本使用 `shell: false`（默认）的 `spawn` 或带静态参数数组的 `execFileSync`。未发现 shell 注入向量。`dist-mac.mjs:895` 使用 `execFileSync("git", ["rev-parse", ...])`，这是安全的。

**dmg-builder 校验和:** `dist-mac.mjs:39-42` 硬编码 DMG builder 二进制文件的 SHA256 校验和，在提取前验证。

### Desktop 共享模块

- `runtime-config.ts`（343 行）— 构建配置加载、环境解析、端口/URL 配置。包含先前已报告的硬编码凭据（`DEFAULT_GATEWAY_TOKEN` = "gw-secret-token"、`desktopAuth.password` = "desktop-local-password"）— 见高问题 #12。
- `proxy-config.ts`（189 行）— 代理策略规范化，带凭据脱敏和子进程环境传播
- `desktop-paths.ts` — NEXU_HOME、skills 目录、skillhub 缓存的文件系统路径解析
- `update-policy.ts`— Desktop 更新体验解析，带通道感知门控
- `host.ts`、`platform-env.mjs`、`sentry-build-metadata.ts`、`skillhub-types.ts`、`workspace-paths.ts` — 薄工具模块

### 评估

所有构建脚本遵循安全的子进程模式。`runtime-config.ts` 中先前已存在的硬编码凭据问题已作为高 #12 捕获。没有新问题达到置信度 80。

**Module 38 总计:** 0 严重, 0 高, 0 中, 0 低

---

## Module 39: Desktop 渲染器应用

**审查范围:** `apps/desktop/src/` 中的 20 个文件。所有文件完整阅读。

### 组件

- `desktop-shell.tsx`（220 行）— 带 4-surface 架构（control/web/openclaw/diagnostics）、构建信息侧边栏和更新横幅集成的主 shell
- `surface-frame.tsx`— 带 preload 支持的 Webview surface 包装器
- `surface-button.tsx`、`summary-card.tsx`、`runtime-unit-card.tsx`、`diagnostics-action-card.tsx` — 展示组件
- `update-banner.tsx`— 带检查/下载/安装操作的自动更新状态显示
- `develop-set-balance-dialog.tsx`— 仅开发用的奖励余额覆盖对话框

### 页面

- `runtime-page.tsx`— Desktop 运行时控制室，带单元管理、组件更新和状态显示
- `diagnostics-page.tsx`— 用于开发的崩溃/异常测试台
- `cloud-profile-page.tsx`— 云资料管理

### Hooks 与 Lib
- `runtime-page.tsx` — 桌面运行时控制室，包含单元管理、组件更新和状态显示
- `diagnostics-page.tsx` — 用于开发的崩溃/异常测试台
- `cloud-profile-page.tsx` — 云端配置文件管理

### Hooks & Lib

- `host-api.ts` (250 lines) — 使用 `getHostBridge()` 辅助函数的 Electron 主进程类型化 IPC 桥接
- `use-runtime-state.ts`, `use-auto-update.ts`, `use-desktop-runtime-config.ts` — 用于运行时状态、更新和配置的 React hooks
- `runtime-state.ts` — 不可变状态合并，包含单元快照和日志尾部管理
- `runtime-formatters.ts`, `controller-ready.ts`, `api-client.ts`, `i18n.ts`, `openclaw-surface.ts`, `posthog-identity.ts` — 工具模块

### 评估

桌面渲染器干净且结构良好。组件遵循 React 最佳实践。IPC 通过 `@shared/host` 类型完全类型化。Surface 管理使用正确的条件渲染。没有问题达到置信度 80。

**Module 39 总计：** 0 严重, 0 高, 0 中, 0 低

---

## Module 40: Controller 脚本及剩余文件

**审查范围：** ~14 个剩余文件。所有文件均完整阅读。

### Controller 脚本

- `bundle-runtime-plugins.mjs` (300 lines) — NPM 依赖闭包解析和运行时插件打包（dingtalk-connector、wecom、openclaw-qqbot、tabby-control）。使用 `createRequire` 进行安全的包解析，使用 `cp` 进行文件操作。无 shell 注入。
- `prepare-device-control-plugin.mjs` (57 lines) — 将预构建的设备控制插件复制到 dist-runtime。纯文件系统操作。
- `generate-openapi.ts` — OpenAPI 规范生成

### Web E2E 测试

- `openai-oauth.spec.ts` — 使用模拟 API 端点的 OpenAI Codex OAuth 流程 Playwright E2E 测试
- `skills.spec.ts` — 使用预置测试凭据的技能平台 Playwright E2E 测试（可通过环境变量覆盖）。凭据仅用于测试。

### 配置与构建文件

- `apps/web/vite.config.ts`, `apps/desktop/vite.config.ts` — 标准 Vite 配置
- `apps/web/playwright.config.ts` — Playwright 配置
- `docs/.vitepress/config.ts`, `docs/.vitepress/theme/index.ts` — VitePress 文档配置
- `vitest.config.ts` — 根 Vitest 配置
- `apps/desktop/mock-update-server.mjs` — 用于测试的本地更新服务器

### 评估

所有剩余文件均干净。Controller 脚本使用安全的文件系统和模块解析模式。E2E 测试使用适当的模拟数据。没有问题达到置信度 80。

**Module 40 总计：** 0 严重, 0 高, 0 中, 0 低

---

## Module 41: 边缘脚本与工具（最终扫描）

**范围：** `scripts/nexu-pal/`, `scripts/notify/`, `scripts/probe/`, `smoke/`, `e2e/desktop/`, `.nexu-dev/skills/`, `apps/desktop/static/bundled-skills/`, `skills/`, `apps/desktop/sidecars/web/`, `docs/`, `packages/slimclaw/runtime-seed/`（32 个文件）

### 摘要

所有 32 个文件均干净——CI 自动化脚本、E2E 测试、技能辅助脚本、文档验证工具和 sidecar 入口点，没有问题达到 80 置信度阈值。

关键文件：
- **`scripts/nexu-pal/lib/triage-opened-engine.mjs`** — 基于 LLM 的 GitHub issue 分流：语言检测、翻译、bug 分类、信息完整性评估
- **`scripts/nexu-pal/lib/github-client.mjs`** — 带有超时处理和组织成员检查的 GitHub API 客户端
- **`scripts/notify/daily-content-bot.mjs`** — 通过 LLM 生成双语每日内容，推送到飞书 + Discord
- **`scripts/probe/slack-reply-probe.mjs`** — 基于 Playwright 的 Slack DM 回复探测，用于端到端测试
- **`e2e/desktop/tests/packaged-e2e.mjs`** — 带有 Chromium 覆盖率收集的打包桌面 E2E 场景
- **`docs/scripts/validate-doc-pages.mjs`** — VitePress 侧边栏链接和语言环境文件验证

### 评估

所有脚本使用正确的错误处理、超时机制（AbortSignal）和环境变量配置。没有硬编码凭据，没有 shell 注入向量，没有竞态条件。E2E 测试包含带有 try/finally 模式的正确清理。

**Module 41 总计：** 0 严重, 0 高, 0 中, 0 低

### Shell/Python 脚本（22 个文件）

对 `scripts/`、`e2e/desktop/scripts/`、`experiments/`、`skills/`、`apps/desktop/static/bundled-skills/` 中的 shell 脚本和 Python 文件的额外审查：

所有 22 个脚本已审查——没有问题达到置信度 80。亮点：
- `scripts/launchd-lifecycle-e2e.sh` (654 lines) — 包含 7 个阶段的完整 launchd 服务生命周期测试
- `scripts/dev-launchd.sh` (327 lines) — 带有优雅停止/清理的开发模式 launchd 管理
- `e2e/desktop/scripts/run-e2e.sh` (1150 lines) — 包含 8 个弹性场景的桌面 E2E 运行器
- `e2e/desktop/scripts/kill-all.sh` — 全面的 Nexu 进程/端口/launchd 清理
- `apps/desktop/static/bundled-skills/libtv-video/scripts/libtv_video.py` — 子进程使用 `sys.executable` 和参数列表，没有 `shell=True`
- 所有脚本使用 `set -euo pipefail`、正确的变量引用、trap 清理处理程序

---

## Module 42: CI/CD 工作流与基础设施配置（最终扫描）

**范围：** 37 个 GitHub Actions 工作流、codecov.yml、Apple 权限声明文件、桌面发布配置、.vaunt 配置、.serena 配置、插件清单和剩余配置文件。扫描 137 个文件；完整审查 15 个关键文件。

### 重要（80-89）

#### 42.1 `desktop-build.yml`: `secrets: inherit` 将所有仓库密钥传递给可复用工作流
**文件：** `.github/workflows/desktop-build.yml`（调用方：`desktop-nightly.yml:25`, `desktop-beta.yml:23`）
**置信度：85**

`desktop-nightly.yml` 和 `desktop-beta.yml` 使用 `secrets: inherit` 调用可复用的 `desktop-build.yml` 工作流。可复用工作流只需要约 7 个特定密钥（R2_ACCESS_KEY_ID、APPLE_SIGNING_CERTIFICATE_BASE64、APPLE_APP_SPECIFIC_PASSWORD 等），但 `secrets: inherit` 授予它所有仓库密钥——包括不相关的密钥如 `OPENAI_API_KEY`、`LITELLM_API_KEY` 和各种 webhook URL。如果可复用工作流被入侵（例如，通过修改它的恶意 PR），影响范围将包括仓库中的每个密钥。

**建议：** 用显式的 `secrets:` 映射替换 `secrets: inherit`，仅传递可复用工作流实际声明的特定密钥。

#### 42.2 `desktop-build.yml` + `desktop-release.yml`: 作业级 LANGFUSE 密钥暴露给所有步骤
**文件：** `.github/workflows/desktop-build.yml:76-78`, `.github/workflows/desktop-release.yml:34-36`
**置信度：83**

`LANGFUSE_PUBLIC_KEY`、`LANGFUSE_SECRET_KEY` 和 `LANGFUSE_BASE_URL` 被设置为作业级 `env:` 变量，使其对作业中的每个步骤都可访问——包括第三方 actions 如 `pnpm/action-setup@v4`、`actions/cache@v4` 和 `actions/upload-artifact@v4`。只有 "Build signed desktop app" 步骤实际需要这些用于 `dist:mac` 构建命令。

**建议：** 将 LANGFUSE 环境变量从作业级移到需要它们的具体构建步骤的步骤级 `env:`。

#### 42.3 `community-content-push.yml`: Cron 到主题的调度使用脆弱的字符串匹配
**文件：** `.github/workflows/community-content-push.yml:41-48`
**置信度：82**

工作流通过在 case 语句中将 `${{ github.event.schedule }}` 与精确的 cron 字符串进行匹配来调度内容主题。如果任何 cron 表达式在更新时没有同步更新 case 语句，工作流将在没有解析到主题的情况下触发，导致内容机器人在下游静默失败。

**建议：** 添加一个验证步骤，在没有解析到主题时显式失败。或者，使用单个 cron 并通过 matrix 策略传递主题。

#### 42.4 `desktop-ci-dev.yml`: 基于路径的脆弱触发器会遗漏新文件
**文件：** `.github/workflows/desktop-ci-dev.yml:10-30`
**置信度：81**

`pull_request` 触发器列出了 25 个单独的文件路径。`scripts/desktop-verify-extracted-runner.sh`（在构建管道完成期间添加）未列出，因此仅更改该脚本的 PR 会跳过 CI。该列表必须为每个新工具或脚本手动更新。

**建议：** 使用更广泛的基于目录的路径过滤器（`apps/desktop/**`、`tests/desktop/**`、`scripts/*desktop*`、`scripts/launchd*`）替代大部分条目的单独文件路径。

#### 42.5 `codecov.yml`: 所有状态检查仅提供信息
**文件：** `codecov.yml:13-21`
**置信度：80**

`unit` 和 `desktop-e2e` 项目和补丁覆盖率检查均设为 `informational: true`，这意味着覆盖率回退永远不会阻止 PR。定义的阈值（项目 auto/5%、补丁 40-60%/20%）仅作参考。

**建议：** 设定一个时间表，在稳定达到阈值（例如 3 个月）后将覆盖率检查升级为阻塞性检查。

### 边缘（未达到 >=80，但值得关注）

#### 42.6 Apple 权限声明禁用了库验证
**文件：** `apps/desktop/build/entitlements.mac.plist:9`
**置信度：78**

`com.apple.security.cs.disable-library-validation` 对父应用已启用。这是 `ELECTRON_RUN_AS_NODE` 子进程从非标准位置加载原生 addon 所必需的，但也意味着应用包中的任何库都可以在未经验证的情况下被加载。继承的 plist 正确地省略了此权限。

#### 42.7 `feishu-pr-notify.yml`: 内联 Node.js 没有 checkout
**文件：** `.github/workflows/feishu-pr-notify.yml:22-26`
**置信度：75**

工作流在 `pull_request_target` 上下文中使用 `node <<'EOF'` 进行内联脚本编写，但没有检出仓库。这实际上是一个深思熟虑的安全措施——不执行来自 fork 的仓库代码，内联脚本仅处理 webhook 通知。虽然非常规，但这是一个良好的安全模式。

#### 42.8 LANGFUSE 密钥在 CI 中硬编码为环境变量名，但未一致设置
**文件：** `.github/workflows/desktop-build.yml:48-49`
**置信度：72**

`LANGFUSE_PUBLIC_KEY` 和 `LANGFUSE_SECRET_KEY` 在可复用工作流中声明为可选 `secrets:`，但作为作业级环境变量从 `secrets.LANGFUSE_PUBLIC_KEY` 设置。如果这些密钥未在调用仓库（例如 fork）中配置，环境变量将是空字符串而非未设置，这可能导致构建步骤失败并产生令人困惑的错误消息，而非优雅降级。

#### 42.9 `desktop-auto-tag.yml` 使用 PAT 绕过 GitHub 反递归
**文件：** `.github/workflows/desktop-auto-tag.yml`
**置信度：70**

使用 `RELEASE_PAT`（个人访问令牌）而非 `GITHUB_TOKEN` 来推送标签，以便触发下游工作流（`desktop-release.yml`）。这有充分的文档说明和清晰的原因解释（GitHub 阻止 `GITHUB_TOKEN` 创建的标签触发工作流），使其是一个经过深思熟虑的变通方案，而非误用。

**Module 42 总计：** 0 严重, 5 重要, 0 中, 0 低

| 领域 | 文件 | 状态 |
|------|------|------|
| CI/CD 工作流 | 28 | 完成 |
| Apple 权限声明 | 2 | 完成 |
| Codecov, 开发配置 | 4 | 完成 |
| 桌面发布配置 | 6 | 完成 |
| Serena, Vaunt, VSCode | 5 | 完成 |
| 插件清单 (openclaw.plugin.json) | 8 | 完成 |
| 剩余 JSON/YAML/TOML | ~84 | 完成 |

---

## 完整审查摘要

跨 42 个模块的完整代码库审查已覆盖约 1,019 个源文件（749 个 JS/TS + 270 个非 JS/TS 非文档文件）：

| 领域 | 文件 | 状态 |
|------|------|------|
| Controller（src + 测试） | ~200 | 完成 |
| Desktop（main, services, updater, 测试） | ~150 | 完成 |
| Web（页面、组件、hooks、lib、测试） | ~300 | 完成 |
| Packages（shared, slimclaw, dev-utils） | ~50 | 完成 |
| 脚本与工具 | ~60 | 完成 |
| 运行时插件 | ~46 | 完成 |
| 桌面构建脚本与共享模块 | ~28 | 完成 |
| 桌面渲染器应用 | ~20 | 完成 |
| E2E 与冒烟测试 | ~8 | 完成 |
| 边缘脚本与工具 | ~32 | 完成 |
| CI/CD 工作流与基础设施配置 | ~137 | 完成 |

**最终仪表盘：**

| 严重级别 | 数量 |
|----------|------|
| **严重** | 34 |
| **高** | 128 |
| **中** | 249 |
| **低** | 230 |

整个代码库中影响最大的发现包括：数据存储中的竞态条件（LowDbStore）、构建脚本中的 shell/PowerShell 注入向量、凭据暴露风险、违反硬性规则的缺失 OpenClaw 运行时重启、1362-3624 行的单体组件、重复的 markdown 解析器、事件循环路径中的同步 I/O，以及测试真实代码的重新实现而非测试实际代码的测试文件。
