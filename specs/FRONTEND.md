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

## Layouts

- **`AuthLayout`** — Requires authenticated session, wraps all workspace routes.
- **`WorkspaceLayout`** — Sidebar + main content area.

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
