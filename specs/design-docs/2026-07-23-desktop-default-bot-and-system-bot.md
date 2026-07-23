# Desktop default bot & system bot

- **Date:** 2026-07-23
- **Status:** Implemented (pending live smoke: defaultBotId flip → gateway hot reload)
- **Related:** `specs/design-docs/2026-06-30-in-chat-expert-auto-route.md` (default bot is the find-expert routing entry), `specs/design-docs/2026-06-15-nexu-orchestrator-plugin.md` (team lead = orchestrator; unchanged by this doc)

## Background

"Which bot is the desktop default" currently has **three inconsistent implementations**:

| # | Location | Rule | Zero-bot fallback |
|---|---|---|---|
| 1 | `compileAgentList` — `apps/controller/src/lib/openclaw-config-compiler.ts:402` | active bots sorted by **slug**, index 0 gets `default: true` in `agents.list` | n/a (list empty) |
| 2 | `agentService.getOrCreateDefaultBot` — `apps/controller/src/services/agent-service.ts:58` | first **active** bot in **insertion order** | creates **"Tabby"** / `tabby-local-chat` |
| 3 | `configStore.getOrCreateDefaultBot` — `apps/controller/src/store/nexu-config-store.ts:981` | first bot **regardless of status** | creates **"nexu Assistant"** / `nexu-assistant` |

Consequences:

- The OpenClaw default agent (unbound gateway entrypoints, compat route fallback in
  `misc-compat-routes.ts:241`) is decided by **slug alphabetical order** — the user cannot
  choose it. Live example: a bot named 中国市场本地化策略师 is `default: true` purely by sort.
- Web local chat (`GET /api/v1/bots/default`) uses insertion order, so the web default and
  the OpenClaw default agent **can be different bots**.
- Any bot — including the de-facto default — can be deleted or paused with no guard.
  `deleteBot` (store:1139) cascades channels/schedules; the next default resolution then
  silently re-creates an assistant whose **name depends on which code path ran first**
  (Tabby vs nexu Assistant).

Decision context (2026-07-22 discussion): we deliberately do **not** resurrect OpenClaw's
built-in `main` agent. `main` only materializes when `agents.list` is empty and is a
reserved name (`sessions-runtime.ts:31`); making it first-class would create a second-class
agent outside the bot pipeline (workspace, skills, model binding, session scan, UI). A
**system-owned bot** delivers the same semantics — stable, product-owned default entry —
with zero special-casing. Team orchestration stays lead-bot-based.

## Goals

- **G1** — User-selectable default: `desktop.defaultBotId`, consumed by a **single resolver**
  everywhere (compiler, `/bots/default`, compat fallback).
- **G2** — System bot: product-owned assistant with stable identity; undeletable; factory
  default and final fallback.
- **G3** — Converge the three implementations into one; kill the naming split.

Non-goals: reviving `main`; changing team-lead orchestration; multiple workspaces;
per-channel default overrides (channels already bind explicit `botId`).

## Design

### Data model

- `botResponseSchema` (`packages/shared/src/schemas/bot.ts`) gains
  `origin: z.enum(["user", "system"]).default("user")`. Store schema normalizes the same
  way, so legacy configs parse unchanged. Invariant: **at most one** bot with
  `origin: "system"`.
- Desktop config gains `desktop.defaultBotId?: string`, persisted exactly like
  `desktop.selectedModelId` (normalize in `store/schemas.ts` desktop section).

### Resolver (single source of truth)

```
resolveDefaultBot(config): BotResponse | null
  1. desktop.defaultBotId  → if it points at an active bot, use it
  2. system bot            → origin === "system" && active
  3. first active bot by SLUG order   // matches compiler; kills the insertion-order variant
  4. null                  → callers that must have a bot lazily create the system bot
```

Stale `defaultBotId` (deleted/paused target) is ignored on read; it is cleared on the next
config write, never mutated during a read path.

### System bot lifecycle

- Created **lazily** by the single surviving `getOrCreateDefaultBot` when there is no
  active bot: `origin: "system"`, name/slug per Open Q1. No proactive backfill for existing
  installs — users with bots never see a new bot appear.
- Guards: `deleteBot` / `pauseBot` on `origin: "system"` throw `HTTPException` 400. The
  experthub install-flow and team-service deletion paths are unaffected — they only delete
  bots they created (`origin: "user"`).

### Compiler

- `agents.list` stays **slug-sorted** (deterministic output; avoids spurious gateway
  reloads — same rationale as the `plugins.allow` sort).
- `default: index === 0` becomes `default: bot.id === resolved.id`, where
  `resolved = resolveDefaultBot(config)` is computed once per compile. When the compiled
  list is non-empty, resolver step 3 guarantees a match.
- Changing `defaultBotId` rewrites `openclaw.json` → gateway hot reload. **Verification
  item:** confirm an `agents.list` default flip is hot-reload-safe (unlike
  `models.providers`, which needs `openclawProcess.restart()` per
  `2026-04-14-openclaw-registry-cache-invalidation.md`).

### API (per `specs/references/api-patterns.md`)

- `PUT /api/v1/bots/default`, body `{ botId }` → validates the bot exists and is active,
  writes `desktop.defaultBotId`, `syncAll()`. New route via `createRoute()` + Zod.
- `GET /api/v1/bots/default` keeps its path — semantics upgrade to the resolver (+ lazy
  system-bot creation), so `local-chat.tsx` needs no change.
- `botResponseSchema` gains `origin` → run `pnpm generate-types`, then `pnpm typecheck`.

### Web

- Bots page: "默认" badge driven by the resolver; card menu gets 设为默认 (calls the PUT
  route); system bot pinned to top with delete/pause hidden (server rejects anyway).
- i18n additions in `en.ts` / `zh-CN.ts`.

### Migration & compatibility

- Legacy configs: missing `origin` → `"user"`; missing `defaultBotId` → resolver steps
  2–3. With no user action, behavior is identical to today's compiler order.
- Only visible change: web default now follows **slug order** instead of insertion order,
  aligning web with the OpenClaw default agent. Note in release notes.

### Testing

- Store/service units: resolver precedence (4 branches), stale-id fallback, system-bot
  delete/pause rejection, single-system-bot invariant, user-bot delete cascade unchanged.
- Compiler units: `default` follows `defaultBotId`; output ordering deterministic.
- Smoke (`pnpm dev`): flip default → `openclaw.json` default moves → unbound gateway entry
  (compat chat-completions without `x-openclaw-agent-id`) lands on the new bot.

### Rollout (PR slicing)

1. **PR1** `chore(controller)`: schemas (`origin`, `defaultBotId`) + resolver + converge
   `getOrCreateDefaultBot` into agent-service (delete the store variant after confirming
   no other callers) + guards + tests.
2. **PR2** `feat(controller)`: compiler default flag + `PUT /api/v1/bots/default` + SDK
   regen.
3. **PR3** `feat(web)`: bots page UI, 设为默认, system-bot protected states, i18n.

## Open questions — resolved 2026-07-23

1. **System bot naming** — decided: **"Tabby"** / `tabby-local-chat` (kept agent-service's
   identity); the store's "nexu Assistant" creator was dead code and is deleted.
2. **Pause semantics** — decided: hard-block (HTTP 400 from `assertNotSystemBot`).
3. **Demotion** — decided: system bot stays a normal bot; no hiding.
4. **Store-variant callers** — verified zero callers; `configStore.getOrCreateDefaultBot`
   deleted.

Implementation landed in one pass (PR slicing kept as suggested commit boundaries):
resolver `apps/controller/src/lib/default-bot.ts`; guards + `setDefaultBot` in
`agent-service.ts`; compiler default flag; `PUT /api/v1/bots/default`; web BotSelector
badge + set-default action; tests in `tests/default-bot.test.ts`,
`tests/agent-service.test.ts`, plus compiler/store cases.

## Relation to the "main as orchestrator" idea

`main` stays a reserved name. The system bot already covers the "desktop steward" role:
every compiled agent receives `SUBAGENT_DELEGATION_TOOLS` (find-expert one-turn routing),
so whichever bot is default acts as a per-turn dispatcher out of the box. Persistent
multi-expert orchestration remains the team lead bot's job (`team-service.ts:278`).
