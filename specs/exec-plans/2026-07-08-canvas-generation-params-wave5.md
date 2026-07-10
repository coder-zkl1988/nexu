# Canvas Wave-5 — generation-parameter parity (node settings + model picker)

Status: proposed (2026-07-08)
Related: `specs/exec-plans/2026-07-06-canvas-parity-migration.md` (W1–W4), design doc `2026-07-03-infinite-canvas-sidebar.md`

## Problem (from the W1–W4 parity audit)

The migrated canvas is at **mechanical** parity with the reference (`~/workspace/infinite-canvas`) — image-editing ops, batch groups, aspect-lock, upstream reference-image feed, inline editing all landed. The remaining gap is **generation-parameter richness**: the reference exposes, per generatable node, a ModelPicker + a full settings popover; ours hard-codes everything.

Concrete gaps (reference file:line on the left, ours on the right):
- **No model selection** anywhere — reference `canvas-node-prompt-panel.tsx:84,96,101` ModelPicker per mode; ours none.
- **Image**: reference `image-settings-panel.tsx:9-129` = quality (auto/high/med/low), W/H + 16-align, aspect grid 1:1…16:9 + 2k/4k, count **1–15**; ours `prompt-panel.tsx:271-288` = count **1–4** only.
- **Video**: reference `video-settings-panel.tsx:53-166` = resolution + size presets (横/竖/方/宽/长) + W/H + seconds 6/10/12/16/20 + Seedance 生成声音/水印/智能时长; ours = duration 1–60 + 720/1080 only.
- **Audio**: reference `audio-settings-panel.tsx:31-79` = voice preset grid, format grid, speed 0.75/1/1.25/1.5, 声音指令 textarea; ours = free-text voice + speed.
- **Config node**: reference `canvas-config-node-panel.tsx` = 4 modes (生图/文本/视频/音频), typed input chips, 组装提示词 composer, per-mode ModelPicker + settings; ours `config-node.tsx` = 3 modes, free-text summary, minimal params.
- **Text→text** generate/rewrite (reference text mode); ours only text→image.

## Key facts that shape the approach (verified in code)

1. **Generation is contract-message driven.** `media-generation-service.ts` sends a natural-language `[TASK]` prompt to a utility subagent lane (`pickUtilityBotId`) that calls `image_generate`/an official skill, then polls the session for the file path. Params already flow as **hints** in that message (video `Duration:`/`Resolution:` at `:399-404`, audio `Voice:`/`Speed:` at `:457-462`). **So new params (model/size/quality/aspect/generate-audio/watermark/voice-preset/instructions) are added the same way — as hints the agent/skill honors if able.** This is the exact pattern W2 used for referenceImages; it is additive and low-risk. Effect is best-effort (depends on the active tool/skill), same semantics as today.
2. **Model list already exists.** `GET /api/v1/models` → `modelProviderService.listModels()` (`model-routes.ts:47`), and reusable pickers exist: `apps/web/src/components/model-picker-dropdown.tsx`, `inline-model-selector.tsx`. The canvas ModelPicker reuses this list + a picker; the selection is passed as a **preferred-model hint**. NOTE: these are chat/LLM models, not a separate image-model registry (we have none) — so the picker expresses a *preference* the generation lane honors when the tool supports model choice. Documented so it isn't mistaken for a hard image-model selector.
3. **Schemas + SDK.** Request schemas live in `packages/shared/src/schemas/media-generation.ts`; every change requires `pnpm generate-types`. All new fields are `.optional()` → additive, no web call-site breakage.

## Adaptations (kept from W1–W4 decisions — NOT gaps)

- **No credits / 算力消耗** (reference shows a credit cost; we have no credit concept — local/cloud accounts). Config node keeps a plain 「生成」, no cost line.
- Node title lives in the header chrome (reference is header-less) — no in-body title row needed.
- No canvas-local theme toggle (follows app theme).

## Approach

Backend is a thin additive layer (hints); the weight is frontend — mirror the reference's settings panels + model picker as **our own components** (reference is AGPL → patterns only, zero copy), wired into the existing `prompt-panel.tsx` / `config-node.tsx` / `canvas-generation.ts` seam.

### Touch points

| Area | Change |
|---|---|
| `packages/shared/src/schemas/media-generation.ts` | image: `+model?`, `+size?` (preset key or `{w,h}`), `+quality?`, `+aspectRatio?`, `count.max(4→12)`. video: `+size?`/`+aspectRatio?`, `+generateAudio?`, `+watermark?`. audio: voice stays string (presets are UI), `+format?`, `+instructions?`. All optional. |
| `apps/controller/src/services/media-generation-service.ts` | Append the new fields as hint lines in each contract message (mirror the existing Duration/Voice hint blocks). No enforcement. |
| `apps/web/src/lib/canvas/canvas-generation.ts` | Thread the new params from the panels into the SDK calls. |
| `apps/web/src/lib/canvas/prompt-panel.tsx` + new `canvas-settings/*` | Per-mode settings panels (image/video/audio) + ModelPicker, mirroring the reference field sets. |
| `apps/web/src/lib/canvas/config-node.tsx` + `config-node-logic.ts` | 4th "text" mode, typed input chips (提示词 N / 参考图 N / …), 「组装提示词」composer, per-mode ModelPicker + settings. |
| `apps/web/src/components/*model*` | Reuse the existing model list/picker; add a thin canvas wrapper if needed. |
| `pnpm generate-types` | After the schema change. |

## Task breakdown (SDD — each: implementer subagent → task reviewer → fix loop)

- **W5.1 — Backend hints + schema.** Extend the 3 request schemas (additive) + append hint lines in `media-generation-service`. `generate-types`. Verify: schema unit tests for the new optional fields; existing S7/media controller tests green; SDK diff additive only.
- **W5.2 — Canvas ModelPicker.** A canvas model selector backed by `GET /api/v1/models` (reuse `model-picker-dropdown`), selection → `model` param. Verify: renders the model list, selection flows into `generateImageIntoNode` etc.; empty/error list degrades to "default".
- **W5.3 — Image settings panel.** quality / size (presets + W/H + 16-align) / aspect grid / count 1–12, mirroring `image-settings-panel.tsx`. Verify: values map to the request; count cap honored.
- **W5.4 — Video settings panel.** size/aspect presets + W/H, generate-audio, watermark, duration/resolution. Verify: hints reach the request.
- **W5.5 — Audio settings panel.** voice preset grid (+ custom), format, speed presets, 声音指令 textarea. Verify: maps to voice/speed/format/instructions.
- **W5.6 — Config node upgrade.** 4th "text" mode + typed input chips + 「组装提示词」composer + per-mode ModelPicker/settings. Verify: chips count upstream by type; composer assembles; mode drives the channel.
- **W5.7 — Text→text generate/rewrite.** A text-generation lane (reuse the `describeImage`-style utility-lane pattern: chat.send → poll reply) exposed as `POST /media/generate-text`; text node gains a generate/rewrite mode. Verify: 502/UNAVAILABLE semantics; a real rewrite round-trips. (If scope pressure, split to a follow-up — flag, don't silently drop.)
- **W5.8 — Live gate + docs.** Desktop: pick a model + set size/quality → image reflects the hints (best-effort); config text-mode round-trips. Append a W5 completion record here + sync design doc §.

## Constraints (binding)

- Never `any` (z.infer / `unknown`). All routes `createRoute()`+`app.openapi()`. `generate-types` after schema changes. No new deps (reference panels reimplemented with native inputs, like W1–W4). Never modify OpenClaw source. Credentials never logged. Biome-clean. No commit until the user says so.
- Params are **best-effort hints** — the UI must not imply a hard guarantee (no "this WILL be 4K"); copy stays descriptive ("目标尺寸", "偏好模型").

## Verification (per task)

`pnpm --filter @nexu/shared build` → `pnpm generate-types` (when schema touched) → `pnpm --filter @nexu/controller test` (backend tasks) / `pnpm --filter @nexu/web test` (frontend) → `pnpm typecheck` → `pnpm lint`. Live gate at W5.8.

## Delivery record (2026-07-08)

All seven tasks landed in the working tree (uncommitted, on `feat/nexu-teams`) and are green: **web 608 / controller 503**, full typecheck (7 projects), Biome clean (only the pre-existing `XHSEditor.tsx` suppression warning).

- **W5.1** — additive param hints. `media-generation.ts`: image `+model/quality/aspectRatio/size`, `count.max(4→12)`; video `+model/aspectRatio/generateAudio/watermark`; audio `+model/format/instructions`. `media-generation-service.ts` appends them as contract-message hints; `media-routes.ts` forwards them; `generate-types` regenerated (additive). Tests: hint-coverage + no-hints-when-default.
- **W5.2–W5.5** — `prompt-panel.tsx` gains a model `<select>` (backed by `GET /api/v1/models`, provider-fallback client so provider-less canvas tests never throw) + per-mode settings; pure `build{Image,Video,Audio}GenOpts` builders in `prompt-panel-utils.ts` map state→opts (omit defaults); `canvas-generation.ts` forwards them. Model select is a **preferred-model hint** (chat models, not a separate image-model registry — documented).
- **W5.6** — Config node: typed input chips (提示词/参考图/参考视频/参考音频 N), per-mode settings, a shared `useCanvasModelOptions()` hook (extracted; both panels use it), and a collapsed 「组装提示词」 composer prepended to the upstream prompt. `config.mode` + plan + dispatch extended.
- **W5.7** — text-generation channel: `generateTextRequestSchema`/`ResponseSchema`, `MediaGenerationService.generateText` (utility-lane mirror of `describeImage`, UNAVAILABLE-first), `POST /api/v1/media/generate-text`. Frontend: `generateTextIntoNode` (+ `text` retry kind) and a Config **「文本」** mode (4th mode) that writes a downstream text node.
- **W5.8** — this record; controller restarted to serve the new routes.

**Best-effort semantics:** every new param is a hint the utility lane forwards to the generation agent/skill; effect depends on the active tool (same contract as W2's referenceImages). Real honoring of size/quality/model needs the backing skill to support them — the UI copy stays descriptive ("偏好/目标"), and generation still degrades to UNAVAILABLE→502 when no backend skill is installed.

**Deferred (flagged, not silently dropped):** text-node *inline* generate/rewrite panel (the Config 文本 mode covers text→text today; a per-text-node panel is a small follow-up); retry payloads for image/video/audio carry the pre-W5 params only (the new hints fall back to defaults on retry — extend the `task.retry` union if retry-fidelity is wanted).
