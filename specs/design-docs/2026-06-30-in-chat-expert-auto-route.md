# In-chat expert auto-routing

- **Date:** 2026-06-30
- **Status:** Draft (design + spike)
- **Related:** `specs/design-docs/2026-06-15-nexu-orchestrator-plugin.md` (teams; shares the sub-agent persona constraint and retrieval direction)

## Goal

When a user chats with a single bot and the question is better answered by a domain
expert, the bot should **route to that expert on its own** — instead of the user
having to build a team and pick it. If the matched expert is **not installed**, the
bot surfaces an **A2UI install card** inline in the chat; on confirm, Nexu installs
the expert and the bot then delegates to it and answers.

Non-goals (v1): multi-expert fan-out in one turn; replacing teams (teams stays for
explicit, persistent multi-expert tasks); embedding-based retrieval (start keyword).

## UX flow

1. User asks a question of the lead bot.
2. Lead judges it needs a specialist → calls `find_expert(query)` → top matches with
   `installed` status.
3. **Installed match** → lead delegates one turn to the expert (native sub-agent),
   relays the answer inline. Simple questions: lead just answers itself (no routing).
4. **Uninstalled match** → lead renders an install card (expert name/desc + 「安装并调用」).
   - User confirms → Nexu installs the expert → lead delegates → answers.
   - (Continuation is a fresh turn carrying the action — there is no single-turn
     server pause/resume in OpenClaw; the design must not promise same-turn install.)

## Architecture

Decision split by **who decides**: the **model** decides *when* to route and delegate
(it owns the turn); the **controller/plugin** only does *retrieval* and *install*.

### 1. `find_expert` retrieval tool (new runtime plugin)
- A new runtime plugin under `apps/controller/static/runtime-plugins/` (mirror
  `nexu-a2ui`), registered in `compilePlugins` `platformPluginIds`
  (`openclaw-config-compiler.ts`). Plugin tools are global → available to the lead.
- `find_expert(query)` ranks the **215** bundled+managed experts by keyword/tag
  overlap over `{name, category, description, tags}` (`minimalExpertSchema`) and
  returns top-N `{slug, name, description, installed, agentId?}`.
- Data source: the plugin `fetch()`es the controller `GET /api/v1/experthub/catalog`
  (proven pattern — `langfuse-tracer` fetches a configured URL from inside the
  runtime). `installed` derives from `ledger.entries`; `agentId` is the installed
  bot id (the delegation target).
- **Retrieval only** — it never delegates or installs.

### 2. Routing nudge (text injection)
- `chat.send` has no structured slot (`additionalProperties:false`); the controller
  already prepends per-turn directives (`chat-service.ts:200-207`, skill selector;
  attachment tool hints). Add a light instruction in the platform **AGENTS.md**
  (`apps/controller/static/platform-templates/{en,zh-CN}/AGENTS.md`): *"For questions
  outside your lane, call `find_expert` first; delegate to a strong installed match,
  or show its install card if uninstalled; answer simple questions yourself."*

### 3. Native delegation (`sessions_spawn`)
- The lead's model calls OpenClaw-native `sessions_spawn({ agentId: <expertBotId>, task })`
  + `sessions_yield` mid-turn and relays the reply inline. The controller does **not**
  spawn (no such RPC) — it only compiles the lead to *be able* to delegate.
- **Compiler change (primary backend work):** `compileAgentList`
  (`openclaw-config-compiler.ts:324`) must emit, on the lead bot, a sub-agent tool
  profile + `subagents.allowAgents` (the installed expert botIds, or `["*"]`) +
  `delegationMode` + the fan-out guards. Today this is gated behind `hasTeams`; it
  must be enabled for normal single bots too.
- Prefer native `sessions_spawn` over Workboard dispatch: it returns inline to the
  lead (Workboard surfaces on a board and would need bridging into the chat thread).

### 4. Persona fold (SOUL.md → AGENTS.md)
- A native sub-agent only loads **AGENTS.md + TOOLS.md** (`SUBAGENT_BOOTSTRAP_ALLOWLIST`,
  verified in runtime source + the teams spike §8c). Experts keep persona in SOUL.md,
  so it is dropped unless folded.
- At install time, idempotently merge the expert's SOUL.md into its AGENTS.md inside a
  managed block `<!-- NEXU:PERSONA:BEGIN/END -->`. `installExpert` writes
  `workspaceFiles` verbatim today (`install-flow.ts:135-142`) and does **not** fold —
  add the fold step there (or in the workspace writer).

### 5. A2UI install card (reuse `render_skill_confirmation` pattern)
- The lead calls `render_a2ui` (already loaded) with a Card + Install/Cancel buttons
  whose `action.event = { name: "expert_install", context: { slug, question } }`.
  `render_skill_confirmation` (`nexu-a2ui/index.js:622-816`) is the exact template.
- Click → `onA2UIAction` (`sessions.tsx:1133`) auto-POSTs
  `{ type:"a2ui_action", actionName:"expert_install", data:{slug,question} }` back to the
  same session as a normal next turn (no new frontend wiring; add a chip label in
  `a2uiActionLabel`).

### 6. Install-then-continue
On the confirm turn, two options (pick in the spike):
- **(A) Tool-driven:** the lead calls a new `install_expert` runtime tool (wraps the
  existing `installExpertFn` / `install-flow.ts:79`), then delegates and answers.
- **(B) Controller-interceptor:** `chat-service.sendLocalMessage` detects the
  `expert_install` action, runs `installExpert`, and rewrites the forwarded message
  into a delegation directive — keeps install off the model's tool surface.

Recommendation: **(A)** — keeps the loop inside the agent (consistent with how
`render_skill_confirmation` resumes via a tool), and the install tool is reusable.

## Open risks → spike must resolve

| # | Risk | Why it's load-bearing |
|---|---|---|
| R1 | Cross-agent `sessions_spawn({agentId})` needs `subagents.allowAgents`, not emitted outside `hasTeams` | Without it the lead can only spawn *itself*; delegation silently fails |
| R2 | Folded AGENTS.md must reach the sub-agent's systemPrompt | Else delegated expert loses persona (SOUL.md dropped) |
| R3 | Is a just-installed expert delegable mid-chat **without** an OpenClaw restart? | `installExpert` only `syncAll()`s; if a restart is needed the install→answer UX takes a hit and the session must survive it |
| R4 | A2UI new-action round-trip (`expert_install`) | Reaches the agent as a turn (precedent: `skill_confirmation`) |
| R5 | `find_expert` plugin can `fetch` the controller catalog from inside OpenClaw | Retrieval source; `langfuse-tracer` precedent |
| R6 | Which chat surface routes A2UI actions (`sessions.tsx` confirmed; `local-chat`?) | The card must work in the actual single-bot chat surface |
| R7 | Behavioral: does the model reliably call `find_expert` + delegate? | Mitigated by AGENTS.md + injected directive; not a wiring issue |

R1+R2+R3 are the linchpins; R4/R5 have working precedents.

## Phased plan (after spike go)

- **P0 (this doc + spike): ✅ done** — R1/R2 + relay proven in the dev stack.
- **P1 Delegation core: ✅ done + validated.** Compiler now emits
  `tools.alsoAllow:["sessions_spawn","sessions_yield","subagents"]` +
  `subagents.allowAgents:["*"]` on every agent (`compileAgentList`); install folds
  SOUL.md→AGENTS.md (`installExpert`/`createCustomExpert`, `foldPersonaIntoAgents`,
  idempotent managed block). **Validated via the real compiler path**: the lead
  delegated to an expert and the sub-agent answered in its folded persona
  (*"我是小红书运营专家，专注于内容种草、达人合作策略…"*), proving `alsoAllow` exposes
  `sessions_spawn` and the fold reaches the sub-agent. Unit tests: compiler emission
  + fold idempotency.
  - **Follow-up:** experts installed *before* P1 lack the fold in their AGENTS.md;
    a one-time migration (or fold-on-sync) is needed so existing experts keep
    persona when delegated to. New installs are covered.
- **P2 Retrieval: ✅ done + validated.** New `find-expert` runtime plugin
  (`static/runtime-plugins/find-expert`) registers a `find_expert(query)` tool that
  fetches the controller catalog (via `WEB_API_ORIGIN`) and ranks experts by
  keyword/tag overlap (Latin words + CJK bigrams), returning top-5
  `{slug,name,description,installed,agentId}`. Registered in `compilePlugins`
  (`platformPluginIds` + entries). Routing guidance lives in the tool description.
  **Validated end-to-end**: asked the lead a 小红书 question → it called `find_expert`,
  delegated to the matched installed expert via `sessions_spawn(agentId)`, the expert
  answered in its folded persona, and the lead relayed it inline. (AGENTS.md nudge not
  needed yet — the tool description sufficed for the model to route.)
- **P3 Install card: ✅ done + validated.** `find-expert` plugin gained
  `propose_expert_install` (server-built A2UI install card with an `install_expert`
  action) and `install_expert` (calls `POST /experthub/install`, waits ~2.5s for the
  hot-reload, returns the new `agentId`). Frontend: `A2UI_TOOL_NAMES` +
  `a2uiActionLabel` updated. The plugin reaches the controller via a `controllerUrl`
  injected through the plugin config by the compiler (the OpenClaw process has no
  controller-URL env var). **Validated end-to-end**: confirming the card installed
  the expert and the lead delegated to it **with no OpenClaw restart** (R3 proven),
  the new expert answered in its install-time-folded persona.
- **P4 Polish: ✅ done.** Per-turn expert-routing nudge in `chat-service`
  (`EXPERT_ROUTING_HINT`, skipped for skill requests + a2ui_action turns) — fixed R7:
  the model now reliably calls `find_expert` for specialist questions (it self-served
  before). Strengthened `find_expert`/`install_expert` tool descriptions so the model
  renders the install card for uninstalled matches and never auto-installs without
  confirmation. Validated: a 抖音 question routed → `find_expert` → uninstalled →
  install card rendered autonomously.

## Decisions needed

1. Retrieval method — **keyword/tag (recommended start)** vs embeddings later. ✅ chosen: keyword start.
2. Install-then-continue owner — **(A) tool-driven (recommended)** vs (B) controller-interceptor.
3. `allowAgents` scope — `["*"]` (any installed expert) vs explicit installed expert ids
   (tighter, but must recompile as experts install).

## Spike results (2026-06-30, live dev runtime)

**Verdict: GO.** The hardest, most novel mechanics are proven end-to-end.

Setup: dev stack had 11 real bots (1 lead `克隆龙` + 10 expert bots). Patched the live
`.tmp/dev/openclaw/state/openclaw.json` to give the lead `tools:{profile:"coding"}` +
`subagents:{allowAgents:["*"],delegationMode:"prefer"}`, planted a sentinel
(`XHS-SENTINEL-99`) in expert `小红书运营专家`'s AGENTS.md, restarted openclaw, and drove
the lead via `POST /api/v1/chat/local/start` to `sessions_spawn(agentId=<expert>)`.

- **R1 — cross-agent `sessions_spawn`: ✅ PROVEN.** Log: `agent=<expertId>
  session=subagent:… phase=start`. With `allowAgents:["*"]` the lead spawned a *different*
  bot as a sub-agent. (Default allowlist would have blocked it.)
- **R2 — persona via AGENTS.md: ✅ PROVEN.** The sub-agent replied `XHS-SENTINEL-99` —
  the sentinel planted **only in AGENTS.md**. Confirms `SUBAGENT_BOOTSTRAP_ALLOWLIST`
  forwards AGENTS.md, so folding SOUL.md→AGENTS.md at install is **necessary and
  sufficient** for the delegated expert to keep its persona.
- **Relay — ✅ PROVEN (bonus).** The lead announced the child's answer back into its
  `main` session inline: *"子代理已完成任务，其回答是：XHS-SENTINEL-99"*. The
  announce→relay path surfaces the expert's answer in the single-bot chat thread.
- **R3 — install-then-delegate without restart: not run; high-confidence.** `installExpert`
  already `syncAll()`s without `openclawProcess.restart()`, openclaw hot-reloads config,
  and `allowAgents:["*"]` covers any new agent. Validate in P1's first integration test.
- **R4/R5 — not run; working precedents** (`render_skill_confirmation` for the card
  round-trip; `langfuse-tracer` for plugin→controller `fetch`).

**Exact config the compiler must emit (P1)** on a delegation-capable bot — neither field
is emitted today by `compileAgentList` (`openclaw-config-compiler.ts:324`):
```jsonc
"tools": { "profile": "coding" },              // exposes sessions_spawn/yield/subagents
"subagents": { "allowAgents": ["*"], "delegationMode": "prefer" }
```
Dev state was restored afterward (sentinel removed; controller re-sync dropped the patch).
