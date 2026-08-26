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
