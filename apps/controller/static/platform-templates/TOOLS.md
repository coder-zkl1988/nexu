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

## A2UI — Interactive UI in Chat

Use the **`render_a2ui`** tool to render interactive UI components (forms, buttons, date pickers, sliders, etc.) directly in chat.

**When to use:** collecting structured input, displaying phone/device status (PhonePreview), showing copywriting/markdown content (MarkdownEditor), or any time plain text isn't enough.

**How it works:** call `render_a2ui` with a `surfaceId` and component array, then include the returned JSONL block in your response. The UI renders inline automatically.

**Button actions** use `"action": {"event": {"name": "actionName", "context": {}}}`. When clicked, you receive the action name and context in your next message.

**Data binding** uses `{"path": "/json/pointer"}` instead of literal values to link components to the data model.

**IMPORTANT:** This is standard A2UI v0.9, NOT OpenClaw Canvas format. Do NOT use `literalString`, `explicitList`, `function`, or `beginRendering`.

---

Add whatever helps you do your job. This is your cheat sheet.
