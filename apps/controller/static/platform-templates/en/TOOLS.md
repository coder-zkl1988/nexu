# TOOLS.md - Local Notes

Skills define _how_ tools work. This file is for _your_ specifics — the stuff that's unique to your setup.

## What Goes Here

Things like:

- Camera names and locations
- SSH hosts and aliases
- Preferred voices for TTS
- Speaker/room names
- Device nicknames
- Anything environment-specific

## Examples

```markdown
### Cameras

- living-room → Main area, 180° wide angle
- front-door → Entrance, motion-triggered

### SSH

- home-server → 192.168.1.100, user: admin

### TTS

- Preferred voice: "Nova" (warm, slightly British)
- Default speaker: Kitchen HomePod
```

## Why Separate?

Skills are shared across the Tabby platform. Your setup is yours. Keeping them apart means you can update skills without losing your notes, and share skills without leaking your infrastructure.

<!-- NEXU-PLATFORM-START -->
## Choosing a Search Channel (Browser vs Phone)

Two ways to look things up: the embedded desktop browser (fast, best for open-web pages) and connected phones (required for in-app content — 小红书/抖音/微信 posts, likes, comments, anything behind an app login).

**Default for information gathering: ASK the user which channel, before starting either.** One short question with both options and your recommendation, for example: 「用内置浏览器查（更快），还是用手机在 App 里搜？我建议浏览器。」Then wait for the answer.

Skip the question only in these cases — nothing else qualifies:
- The user already named the channel or the app (「用手机」「在小红书里搜」「上网查」).
- The task must ACT inside an app (like, comment, follow, publish) or read the user's own in-app data (DMs, notifications, own posts) — browser cannot do these; use the phone.
- No phone is connected (`device_list` empty) — use the browser.

A topic living on an app is NOT a reason to skip the question: hot posts and discussions about some topic on 小红书/抖音 are also findable via the browser. "The most natural home for this content is app X" is exactly the reasoning this rule forbids — that choice belongs to the user.

If the channel the user chose fails to start — the embedded browser tool is rejected or errors — SAY SO and offer the alternatives (web fetch, phone), instead of silently substituting a different tool. The user chose a channel; switching it without telling them breaks that choice.

## Device Control

- **ALWAYS call `device_list` fresh** when the user asks about device status, connected phones, or how many devices are online. Device connections change in real-time — never answer from memory or previous call results. Call the tool every time.
- After a device connects or disconnects, previous `device_list` results are stale. Always re-call before answering.
- When the user asks "how many devices" or "are any phones connected", call `device_list` first, then answer from the fresh result.
- **CRITICAL: Do NOT use `nodes`, `memory`, search tools, or any other tool to check device status.** The `nodes` tool queries your knowledge graph (notes/memories), not live hardware. Only `device_list` returns real-time connected device information. Even if `device_list` returned empty before, call it again — devices may have connected since.

## 企业微信任务编排（多实例 × 多企业）

一部手机可能装有多个企微实例（应用分身，桌面图标同名、靠分身角标区分），每个实例内可加入多个企业。企微相关的检查/操作任务必须覆盖**全部实例 × 全部企业**，逐组合执行：

1. 先下发一个枚举任务：让手机找出所有企微实例和每个实例加入的企业清单（打开抽屉即可看到），作为拆解依据。**枚举结果里必须包含每个实例的账号名（抽屉顶部可读），后续逐组合任务文本要带上目标实例的账号名，供手机端进入后自校验。**
2. 再按「实例 × 企业」逐组合下发任务。任务文本必须写明目标实例（「带分身角标的企微」/「不带分身角标的主应用」）与目标企业（「先切换到企业X」），并带全相关关键词（如「分身」「切换企业」「客户朋友圈」）——手机端技能靠任务关键词加载对应操作文档。**不要断言手机当前停留在哪个实例或企业（桌面端无法知道），也不要写「无需切换」；每个任务都要写明「先通过 AWAKE 弹窗进入目标实例」，由手机端完成进入与核对。**
3. **任务内容在手机上，不在聊天记录里。** 1v1（群发助手）和客户朋友圈的待办都是企业在企微内指派的：用户说「执行 1v1 和朋友圈任务」就是让你去手机上查有没有待办并执行。**不要去 memory、历史会话或文件里找「任务定义」**——那里没有，翻找只会空耗十几分钟。只有用户明确给出文案或发送对象时，才用用户给的内容。
4. 检查类任务优先走**消息列表**：每个组合先打开该实例该企业的「消息」tab，在会话列表里找两条官方提醒——「群发助手」（1v1，摘要形如「管理员通知你群发消息给客户」）和「客户朋友圈」（摘要形如「通知你发表内容到客户的朋友圈」）。列表上的未读角标直接说明有没有待办，比翻工作台快且不易漏。消息列表里没有对应条目，才退回工作台入口确认。不能只看当前实例的当前企业就下结论。
5. 指派朋友圈的发表：**只发当天的**——带「昨天」或更早日期的卡片一律跳过并汇报，过期指派内容不补发（与群发助手的今日锁一致）。当天的按时间从最早到最新逐张发表，每张确认成功再下一张。自发朋友圈：先把图片推送到手机（落入「Tabby」相册），任务文本写明张数与文案。
6. 每个实例的全部企业完成后，要求手机切回进入时的原企业，再开始下一个实例。
7. 最终汇报按「实例 × 企业」逐条列出结果；某组合失败或被跳过必须显式说明原因，不得合并成一条总结。

## A2UI — Interactive UI in Chat

Use the **`render_a2ui`** tool to render interactive UI components directly in the chat. This tool MUST be called — the system renders the UI automatically from the tool result. You do NOT need to include any JSONL or code blocks in your text reply.

### Mandatory Use Cases

**PhonePreview — Device Status Display**
- When asked "how many phones", "show connected devices", "what devices are online", or similar — call `device_list` first, then immediately call `render_a2ui` with PhonePreview to display the results.
- Use catalogId: "https://nexu.app/a2ui/custom-catalog.json".
- After calling the tool, simply say something like "Here are the connected devices:" — the UI renders automatically. Do NOT repeat device info in text.

### MarkdownEditor — Canvas Display (opt-in only)

- **Default: do NOT use MarkdownEditor.** Put generated copywriting, summaries, and task results directly in your chat reply as normal markdown — the chat flow renders markdown natively.
- Only call `render_a2ui` with MarkdownEditor when the user EXPLICITLY asks to show content on the infinite canvas (e.g. "放到画布上", "在无限画布中展示", "show it on the canvas") or explicitly asks for a standalone document panel.
- Use catalogId: "https://nexu.app/a2ui/custom-catalog.json".
- When you do use it, keep your text reply to a brief intro — the full content goes in the MarkdownEditor component.

### XHS Ops — KOC Account Nurturing (小红书养号)

When the user wants to run the KOC nurturing workflow (养号项目/目标画像/账号人设/当日养号任务), render the matching stage component with `render_a2ui` — in order, one stage at a time:

1. **XhsOpsProjectForm** — collect/edit customer business + target-audience info. After save you receive `xhs_ops_project_saved`; then generate the target-user profile from the saved data.
2. **XhsOpsProfileCard** — present the proposed profile for HUMAN confirmation. Wait for `xhs_ops_profile_confirmed` (or `_regenerate`). NEVER proceed to personas before the user confirms — this gate is a product requirement.
3. **XhsOpsAccountPlanner** — persona suggestions: TEN by default, each with structured demographics `persona{age, gender, region, occupation, lifeStatus}`, differentiated from each other yet jointly matching the confirmed profile; + phone binding + interest-pool editing.
3b. **XhsOpsProfileMaterial** (optional, after personas are saved) — render with just `projectId`. The desktop generates nickname/bio and 3 avatar + 3 cover candidates on button click; the user picks/edits. 「应用到手机」 edits the account's PUBLIC profile through the phone and is only ever triggered by the user — never by you. You receive `xhs_ops_profile_applied` with status/result.
4. **XhsOpsRunPlanner** — render with just `projectId`: the desktop generates today's per-account plan from each interest pool (core rotation, avoids the previous run's set, home-feed from searchRatioPercent) and shows the rationale; pass `plans` only when the user dictated keywords/counts. Launch, live progress, post-run review. After `xhs_ops_run_finished`, do NOT re-dispatch — help the user review instead.

Never render these stages as plain text or markdown lists. Use catalogId: "https://nexu.app/a2ui/custom-catalog.json".

### Other Components

**Form components** (TextField, CheckBox, ChoicePicker, Slider, DateTimeInput) — use for collecting structured user input.

**Container components** (Column, Row, Card, List, Tabs, Modal) — use for layout.

### Rules

- **CRITICAL: NEVER include raw JSONL or ```a2ui code blocks in your text reply.** The tool result renders automatically. Your text message is separate.
- This is standard A2UI v0.9, NOT OpenClaw Canvas format. Do NOT use `literalString`, `explicitList`, `function`, or `beginRendering`.
- Use a unique `surfaceId` for each separate UI (e.g., `phone-preview`, `copywriting-result`).
<!-- NEXU-PLATFORM-END -->
---

Add whatever helps you do your job. This is your cheat sheet.
