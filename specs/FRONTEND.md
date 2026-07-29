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
| `/workspace/settings` | Models / Settings | General profile and model provider settings |
| `/workspace/models` | Models / Settings | General profile and model provider settings |
| `/workspace/skills` | Skills | Skill catalog |
| `/workspace/skills/:slug` | Skill Detail | Individual skill info and actions |

## Layouts

- **`AuthLayout`** — Requires authenticated session, wraps all workspace routes.
- **`WorkspaceLayout`** — Sidebar + main content area.

### Session workbench

Session detail pages expose browser and canvas controls beside the conversation header. Both modes share the resizable right-side workbench, and their header controls show an activity dot while the corresponding surface is open.

The embedded browser supports up to eight tabs, navigation controls, generated-page auto-open, DOM element selection into the current chat input, and screenshot annotation into an image attachment. Arbitrary pages run in sandboxed Electron `WebContentsView` instances with Node integration disabled; the trusted application webview remains the only surface with the desktop preload bridge. In non-desktop web builds, the browser falls back to a sandboxed iframe without element selection or screenshot capture.

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
