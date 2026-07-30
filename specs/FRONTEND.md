# Frontend

## Stack

React 19 + Radix UI + Tailwind CSS 4 + Vite 6. React Router for routing, React Query for server state, better-auth client for sessions.

## API client

Always use the generated SDK from `apps/web/lib/api/`. Never use raw `fetch`.

The SDK is generated from the API's OpenAPI spec:

1. API defines Zod schemas → auto-generates OpenAPI spec
2. `pnpm generate-types` runs `@hey-api/openapi-ts` → generates TypeScript client at `apps/web/lib/api/`
3. Frontend imports from generated `sdk.gen.ts`

After any API route/schema change: `pnpm generate-types` then `pnpm typecheck`.

## Pages

| Route | Page | Purpose |
|-------|------|---------|
| `/` | Welcome | Desktop-first entry point for Cloud sign-in or BYOK setup |
| `/claim` | Slack Claim | Claim a pending Slack workspace invitation |
| `/feishu/bind` | Feishu Bind | Handles Feishu bind result feedback |
| `/workspace` | Home | Workspace dashboard and channel status |
| `/workspace/home` | Home | Workspace dashboard and channel status |
| `/workspace/sessions` | Sessions | Bot conversation sessions |
| `/workspace/sessions/:id` | Sessions | Session detail |
| `/workspace/channels` | Channels | Multi-platform channel management (Slack, Discord, Feishu) |
| `/workspace/channels/slack/callback` | Slack OAuth Callback | Handles Slack redirect |
| `/workspace/integrations` | Integrations | Composio toolkit connections (OAuth) |
| `/workspace/oauth-callback/:integrationId` | OAuth Callback | Handles Composio OAuth redirect |
| `/workspace/rewards` | Rewards | Reward task center for daily, open-source, and social claims |
| `/workspace/settings` | Models / Settings | General profile, model providers, and unified device/automation controls |
| `/workspace/models` | Models / Settings | General profile, model providers, and unified device/automation controls |
| `/workspace/skills` | Skills | Skill catalog |
| `/workspace/skills/:slug` | Skill Detail | Individual skill info and actions |

### Skill Store data flow

- `Explore` uses cursor pagination through the generated SDK. The controller proxies `https://tabby.picaso.studio/api/v1/skill-catalog`, which is the server-side ClawHub mirror.
- `Yours` and install progress use the lightweight local `/api/v1/skillhub/status` endpoint. They do not wait for the remote catalog.
- While a queue item is active, React Query polls local status every three seconds; the full catalog is not re-downloaded for progress updates.
- Catalog identity is `@ownerHandle/slug`. The owner and installed version are persisted in the local ledger so duplicate slugs from different publishers remain distinguishable.
- If the mirror is unavailable, only the first page may fall back to the legacy local cache. A failed remote continuation page is surfaced as an error rather than mixing two catalog revisions.
- `Explore` exposes server-backed download, star, and recently-updated sorting, the full category facet list, catalog freshness, publisher/version metadata, and compact download/star counts. Search results are not filtered again in the browser, so publisher-only matches remain visible.
- A one-click update is shown only when an installed `managed` skill has the exact same owner-scoped identity and the catalog version is newer. The detail page follows the local queue until completion and then refreshes the installed version.
- Active updates cannot be cancelled or uninstalled because the underlying atomic replacement cannot be interrupted safely after the staged directory swap. Legacy ownerless installs remain available under `Yours` but are never attributed to an owner-scoped catalog card.

## Layouts

- **`AuthLayout`** — Requires authenticated session, wraps all workspace routes.
- **`WorkspaceLayout`** — Sidebar + main content area.

### Session workbench

Session detail pages expose browser and canvas controls beside the conversation header. Both modes share the resizable right-side workbench, and their header controls show an activity dot while the corresponding surface is open.

The embedded browser supports up to eight tabs, navigation controls, generated-page auto-open, DOM element selection into the current chat input, and screenshot annotation into an image attachment. Arbitrary pages run in sandboxed Electron `WebContentsView` instances with Node integration disabled; the trusted application webview remains the only surface with the desktop preload bridge. In non-desktop web builds, the browser falls back to a sandboxed iframe without element selection or screenshot capture.

Absolute HTTP(S) links in session Markdown open in the embedded browser. A link request never retargets a tab pinned by an active browser agent; in that case the URL falls back to the system browser. Explicit link navigation also wins over older generated-page artifacts so a stale preview cannot steal focus.

The chat composer attachment menu separates images, files, and directories. Desktop selection copies authorized paths into the app-owned inbound staging directory and sends only staged paths across the local controller boundary; browser-only use falls back to bounded inline base64 attachments. Shared limits cover item count, per-file/image size, inline payload size, and total message size. Session history renders Office and other generated `MEDIA:` files as typed download cards.

Xiaohongshu editors stay inline in the conversation. The canvas also exposes native Xiaohongshu and phone-preview nodes for AI copy generation, connected images, device selection, and publishing. A publish result with unknown phone status is non-terminal and must not be retried automatically, which avoids duplicate posts.

Generated local pages are discovered from `index.html` / `index.htm` files under the active Bot workspace and served through the controller's constrained preview route. Preview file resolution must remain inside the selected project root after `realpath` resolution, including symlink checks.

## Long-running sessions

The session detail composer remains usable while the session is busy, but it
does not submit a second normal turn because concurrent main-session turns can
corrupt OpenClaw's active transcript. Busy messages are classified before send:

- The busy composer exposes `Auto`, `Quick question`, and `Adjust task` modes.
  An explicit mode is authoritative and bypasses intent classification. Quick
  answers render in a separate panel, do not enter the main conversation
  context, and dismiss automatically eight seconds after completion.
- Exact stop requests abort the active run. While the busy composer is empty,
  its single action button stops the run; typing replaces it with the send
  action so stop and send are never shown together.
- The busy composer replaces attachment and Skill controls with a stable
  segmented intent control because BTW/Steer accept text only; the current bot
  and model remain visible as read-only context.
- High-confidence adjustment messages use OpenClaw's `sessions.steer` RPC.
  OpenClaw stops the active run, waits for it to release the session, and then
  starts a replacement run with the updated guidance. This avoids concurrent
  session writers while preserving the existing conversation context.
  In Auto mode, `/btw`, `/side`, `/steer`, and `/tell` remain explicit intent
  selectors and exact stop commands remain local. Other natural-language input
  uses the Controller's isolated model classifier so routing is not tied to a
  Chinese/English keyword list. Low-confidence results ask the user to choose;
  classifier timeout or failure safely falls back to the isolated BTW lane.
- Controller busy state tracks both the interrupted request and its replacement
  until their terminal events arrive. BTW side-run ids remain isolated. The
  frontend timeout fallback only clears local waiting state after the controller
  reports that no main request is active.
- When Steer interrupts a run, Controller history projection removes OpenClaw's
  duplicate gateway abort snapshot and marks the preserved provider output as
  aborted. The frontend keeps that incomplete output inside the activity group
  instead of presenting it as a completed assistant reply.

## Channels

Channel management lives at `/workspace/channels` ([`apps/web/src/pages/channels.tsx`](../apps/web/src/pages/channels.tsx)). Slack and Discord remain single-instance per workspace; Feishu and WeChat support multi-instance connections.

### Multi-instance Feishu / WeChat

Feishu (`feishu`) and WeChat (`wechat`) channels can onboard multiple accounts, each independently routed to one bot:

- **Bot required at connect time.** The connect form for Feishu / WeChat uses [`<BotPicker />`](../apps/web/src/components/channels/bot-picker.tsx) as a required field. Submitting without a selection surfaces the `channels.errors.botRequired` toast.
- **Instance list rendering.** For `feishu` / `wechat`, `channels.tsx` renders a list of connected instances plus a "Connect another" action. Other channel types keep the existing single-instance UI.
- **Instance cards.** Each [`<ChannelInstanceCard />`](../apps/web/src/components/channels/channel-instance-card.tsx) shows the account id, status, and a "Routes to bot: X" row with an inline "Change" button. Changing the bound bot calls `PATCH /api/v1/channels/:id` via the [`useUpdateChannelBot`](../apps/web/src/hooks/use-update-channel-bot.ts) hook.
- **Platform badge.** The platform picker shows an "N connected" count for Feishu / WeChat once at least one instance is connected; other platforms keep the existing check / loader icon behavior.

Out of scope (possible follow-up, plan D): routing different chats under the same Feishu / WeChat account to different bots.

### Per-channel Feishu permissions

Each Feishu channel instance exposes four permissions via the [`FeishuPermissionsPanel`](../apps/web/src/components/channels/feishu-permissions-panel.tsx) collapsible panel on its [`<ChannelInstanceCard />`](../apps/web/src/components/channels/channel-instance-card.tsx):

- `requireMention` — single toggle. When enabled (default), the bot only replies in groups when @-mentioned.
- `dmPolicy` — `open` (default) / `allowlist` / `disabled`. Controls direct messages.
- `groupPolicy` — `open` (default) / `allowlist` / `disabled`. Controls group messages.
- `allowFrom` — Feishu `open_id` list, shown only when either policy is `allowlist`.

Backward compatibility: when `channel.feishuPermissions` is `null` (historical records), the channel binding compiler emits the previously-hardcoded defaults (`requireMention: true`, `dmPolicy: open`, `groupPolicy: open`, `allowFrom: ["*"]`).

Persistence flow: UI → [`useUpdateFeishuPermissions`](../apps/web/src/hooks/use-update-feishu-permissions.ts) → `PATCH /api/v1/channels/{channelId}/feishu-permissions` → store → `openclawSyncService.syncAll()` → OpenClaw `feishu.accounts[<accountId>]` fields.

## Conventions

### Device and automation settings

The models/settings page includes one `LocalAutomationSettingsSection` card for Android device control, Browser control, and Computer Use. It reads the generated `GET /api/v1/runtime-config` contract once, updates Android through `PATCH /api/v1/runtime-config/device-control`, and updates Browser / Computer Use through `PATCH /api/v1/runtime-config/local-automation`. Toggle rows do not expose implementation details such as backend or transport descriptions; runtime status, required permission actions, and security warnings remain visible.

- Browser control exposes the bundled OpenClaw MV3 extension folder and generates a host-local pairing string. It controls only tabs the user places in the OpenClaw tab group.
- Computer Use reports the packaged platform backend and its permission state. macOS 15+ uses Peekaboo, shows each missing Screen Recording, Accessibility, or Event Synthesizing permission, triggers the request from the signed Peekaboo process, and opens the matching System Settings pane for manual completion; older macOS versions remain unsupported without blocking the rest of Nexu. Windows uses CUA. Unknown or stopped backends must render as warnings rather than healthy installed state.
- Both capabilities default off. The UI must not imply that a sidecar being present means a system permission has been granted.
- Only Browser and Computer Use are explicitly labeled Preview; Android device control remains outside that boundary in the same card. Stable production builds expose `previewEnabled=false`, reject new enable/pairing/permission operations, and still allow stale enabled values to be switched off. Preview copy must state that structured consequential-action approval is not implemented yet.

- **State:** React Query for all server state. No manual `fetch` + `useState` patterns.
- **Auth:** `apps/web/src/lib/auth-client.ts` for session management.
- **Toasts:** sonner. **Icons:** lucide-react.
- **Styling:** Tailwind CSS 4. No component library.
- **Components:** Reusable UI components in `src/components/ui/` (Radix UI primitives).

## Key files

- `src/main.tsx` — React entry point
- `src/app.tsx` — Router setup
- `src/lib/auth-client.ts` — better-auth client
- `lib/api/` — Auto-generated SDK (do not edit manually)
