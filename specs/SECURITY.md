# Security

## Reporting vulnerabilities

**Do not use this file to submit new security issues.** For responsible disclosure (what to send, scope, timelines), see **[`SECURITY.md`](../SECURITY.md)** in the repository root.

The sections below are **implementation and architecture notes** for developers and auditors.

## Credential handling

- All channel credentials (bot tokens, signing secrets) encrypted at rest with AES-256-GCM
- Encryption key: 32-byte hex from `ENCRYPTION_KEY` env var
- Implementation lives in the active controller-side secret and crypto helpers
- Credentials decrypted only when needed (config generation, signature verification)
- **Credentials must never appear in logs, error messages, or API responses**

## Slack signature verification

- All incoming Slack events verified via HMAC-SHA256
- Signing secret retrieved from encrypted `channel_credentials`
- 5-minute timestamp window enforced
- Timing-safe comparison (`crypto.timingSafeEqual`)
- Implementation follows the active controller/runtime event handling path

## Authentication

- better-auth with email/password registration
- HTTP-only session cookies
- `authMiddleware` validates session for all `/v1/*` routes
- Configured in the active controller auth stack

## Desktop local control plane

- The controller is a loopback-only control plane. Its global HTTP middleware rejects non-loopback `Host` values, non-loopback browser `Origin` values, and `Sec-Fetch-Site: cross-site` before CORS or route handlers run.
- The controller's direct WebSocket upgrade path applies the same guard before device mirror/control sockets reach `DeviceMirrorProxy`.
- The packaged embedded web server does not reflect request origins or enable credentialed CORS. It applies equivalent checks to proxied HTTP, preflight, and WebSocket requests.
- OpenClaw Control UI accepts only the configured local web origin and explicit loopback gateway origins. Host-header origin fallback remains disabled.
- These checks are required even when the process binds `127.0.0.1`: CORS alone does not stop DNS rebinding, and WebSocket upgrades do not use CORS.
- Local automation lifecycle operations are serialized. A completed disable operation must leave both persisted capability state and its platform daemon disabled, even when permission requests arrive concurrently.
- Browser control drives only the app's own embedded browser view, through Electron's in-process `webContents.debugger`. Nexu never opens a remote-debugging port: that would expose every WebContents in the app — including renderers holding the user's session — to any local process, and a filtering proxy cannot contain it because anything can connect to the port directly.
- Browser commands execute in the main process, which owns the view. Any command that acts on the page — click, type, scroll — first raises the panel and waits for it to host the view, so the user sees the action that is about to happen. This is also a hard requirement rather than a courtesy: synthesized input into a view the panel has not placed is silently dropped.
- Computer Use is constrained by both the compiled MCP include list and a runtime plugin allowlist. Unknown Peekaboo/CUA tools fail closed; Peekaboo's nested `agent` and remote-debugging `browser` tools are not valid substitutes for Nexu's reviewed Computer Use surface.
- OpenClaw runs compile with `tools.exec.security="full"` and `tools.exec.ask="off"`; `exec` and `process` remain available by default for every session source and are not blocked again by `nexu-toolcall-guard`. Non-sandbox runs execute on the local gateway, while `SANDBOX_ENABLED=true` routes the same tools to the sandbox. Plugin-owned permission prompts remain governed by the plugin that requested them and are not silently auto-resolved by this setting.
- `commands.ownerAllowFrom` must not contain a wildcard. OpenClaw 2026.7.1 reads a wildcard command owner as "every sender is an owner", which exposes the owner-only `nodes`, `gateway`, and `cron` tools to any channel.
- A successful Computer Use tool return proves only that the provider accepted or dispatched an action. Nexu accepts completion evidence only when CUA 0.12.6 returns `verified: true` through trusted structured output, an enriched provider verification matches the invocation's property/expected/element metadata, a typed/assigned value is read back from the same element reference and app/window/snapshot, or a launched target is subsequently observed. Verification-shaped arbitrary text is never trusted. `set_value` evidence requires normalized equality for the complete value field; prefixes, substrings, and similarly named keys such as `default_value` are insufficient. Clearing a field requires an explicit structured empty value or quoted `value=""`/`value=''` evidence from that exact element. Unstructured observation text must identify the element at the line prefix or in an explicit ID field; an ID substring or prefix collision is not evidence. A generic same-target screenshot does not prove that a click, hotkey, scroll, drag, menu, dialog, Dock, or window action achieved its intended result; those actions remain unverified until the provider exposes an action-specific postcondition. Text evidence must come from actual value fields, never labels, titles, or unrelated page text. A failed action remains unresolved unless the exact tool invocation is retried successfully, and every unresolved mutation remains independently pending. Targetless/frontmost mutations remain unverified. Launch results may add provider-returned PID/window aliases so a Windows launch-by-name can be verified through its actual process/window identity.
- Chat `final`, `error`, and `aborted` events are terminal only for their `runId`. The Controller freezes and caches an unverified final decision so every concurrent SSE subscriber receives the same failure, suppresses late/replayed chat events for that run, keeps a session-level SSE connection available to later runs, and continues to permit independent side results. The pending-session UI maintains its own terminal latch for SSE error/aborted events so they cannot be overwritten by a late delta or success notification; session-discovery retries do not consume that SSE terminal state.
- The runtime plugin rewrites unverified terminal assistant messages before transcript persistence, and the Controller independently converts the corresponding desktop SSE `final` event to `local_automation_unverified`. These are complementary integrity checks; prompts and model self-reporting are not completion evidence.

### Internal API — Two-token model

Internal endpoints (`/api/internal/*`) use a two-tier token system:

| Token | Env var | Purpose | Who holds it |
|-------|---------|---------|-------------|
| Internal token | `INTERNAL_API_TOKEN` | Privileged operations (config, secrets mgmt, skill sync) | Controller-managed local runtime only |
| Skill token | `SKILL_API_TOKEN` | Skill-facing operations (fetch scoped secrets, record artifacts) | OpenClaw child process (via env) |

**Middleware:**
- `requireInternalToken(c)` — accepts only `INTERNAL_API_TOKEN`
- `requireSkillToken(c)` — accepts `SKILL_API_TOKEN` or `INTERNAL_API_TOKEN` (superset)
- Both use `crypto.timingSafeEqual` for constant-time comparison
- Implementation follows the active controller internal-auth middleware

**Endpoint mapping:**

| Endpoint | Auth |
|----------|------|
| `GET /config`, `GET /config/latest`, `GET /config/versions/:v` | `requireInternalToken` |
| `POST /register`, `POST /heartbeat` | `requireInternalToken` |
| `PUT /secrets` | `requireInternalToken` |
| `POST /sessions`, `PATCH /sessions/:id`, `POST /sessions/sync-discord` | `requireInternalToken` |
| `GET /secrets/:skillName` | `requireSkillToken` |
| `POST /artifacts`, `PATCH /artifacts/:id` | `requireSkillToken` |
| `POST /composio/execute`, `POST /composio/disconnect` | `requireSkillToken` |

### OpenClaw process isolation

The gateway strips privileged env vars before spawning the OpenClaw child process:
- `INTERNAL_API_TOKEN` — **not inherited** by OpenClaw
- `ENCRYPTION_KEY` — **not inherited** by OpenClaw
- `SKILL_API_TOKEN` — inherited, used by skills to fetch scoped secrets

`nexu-context.json` (written by gateway sidecar) contains only `apiUrl`, `poolId`, and `agents` — no tokens or secrets on disk.

## Pool secrets scoping

- Secrets stored in `pool_secrets` table, encrypted with AES-256-GCM
- Each secret has a `scope` field: `pool` (available to all skills) or `skill:<name>` (specific skill only)
- Skills fetch their secrets at runtime via `GET /api/internal/secrets/:skillName` using `SKILL_API_TOKEN`
- API returns only secrets where `scope = 'pool'` OR `scope = 'skill:<skillName>'`

## Secret management

- Production: AWS Secrets Manager → External Secrets Operator → K8s Secrets
- Local dev: `.env` file (never committed)
- Required: `DATABASE_URL`, `ENCRYPTION_KEY`, `INTERNAL_API_TOKEN`, `SKILL_API_TOKEN`, `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`, `BETTER_AUTH_SECRET`
- Optional: `LITELLM_BASE_URL`, `LITELLM_API_KEY`

## OAuth state

- Slack OAuth state tokens stored in `oauth_states` table with expiry
- State verified on callback to prevent CSRF
- Tokens marked as used after consumption (single-use)

## Composio integration OAuth

- Third-party OAuth flows (Gmail, Google Calendar, etc.) managed via Composio SDK
- `user_integrations` table tracks per-user OAuth connection state
- `integration_credentials` stores encrypted credential material (AES-256-GCM)
- OAuth state parameter stored in `user_integrations.oauth_state` for CSRF prevention
- Connection URLs generated server-side (`composio-routes.ts`) — never crafted client-side
- `composio-exec.js` runs in OpenClaw child process with `SKILL_API_TOKEN` only (no `INTERNAL_API_TOKEN`)
- Auth endpoint: `POST /api/internal/composio/execute` requires `requireSkillToken`
- Disconnect endpoint: `POST /api/internal/composio/disconnect` requires `requireSkillToken`

## Review checklist

- [ ] No credentials in log output or error messages
- [ ] New API endpoints behind `authMiddleware`, `requireInternalToken`, or `requireSkillToken`
- [ ] Encrypted storage for any new secret material
- [ ] Slack signature verification for any new webhook endpoint
- [ ] No `ENCRYPTION_KEY` or tokens in committed code
- [ ] New loopback HTTP or WebSocket surfaces reject hostile Host/Origin values and include DNS-rebinding regression coverage
- [ ] Local automation mutations have fresh same-target completion evidence, typed/assigned values are bound to the same stable element ID in that evidence, and host `exec`/`process` cannot bypass the declared capability boundary
