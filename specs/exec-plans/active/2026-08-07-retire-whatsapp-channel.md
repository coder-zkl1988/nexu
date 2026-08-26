# Retire WhatsApp Channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the WhatsApp channel from Nexu entirely — bundled plugin, controller service and routes, shared schemas, web UI, and docs — reclaiming ~40 MB of uncompressed payload.

**Architecture:** WhatsApp is a first-class channel spanning six layers. Removal proceeds bottom-up with one hard ordering constraint: a config migration that strips legacy `whatsapp` channel entries **must land before** the channel-type enum stops accepting the value, or existing users lose their entire configuration (see Global Constraints).

**Tech Stack:** TypeScript, Zod, Hono + `@hono/zod-openapi`, React, Vitest, pnpm workspaces.

Design doc: `specs/design-docs/2026-08-06-plugin-bundle-size-reduction.md` (Change 3).

## Global Constraints

- **Task 1 must be completed and merged before Task 2.** `LowDbStore.read()` falls back to `createDefault()` and immediately persists it when both the config and its `.bak` fail schema validation (`apps/controller/src/store/lowdb-store.ts:27-48`). Removing `"whatsapp"` from `channelTypeSchema` without a pre-parse migration therefore wipes every bot, channel, model provider, and template for any user who connected WhatsApp — irreversibly, on first launch after update.
- `transform.onRead` runs *after* `schema.parse` (`lowdb-store.ts:89-95`) and cannot be used for this. A new pre-parse hook is required.
- **Never use `any`.** Use `unknown` with narrowing or `z.infer<typeof schema>`.
- **All API routes use `createRoute()` + `app.openapi()`.** Deleting routes must not leave plain `app.get()`/`app.post()` behind.
- **Run `pnpm generate-types` after route or schema changes**, then update call sites. The generated `apps/web/lib/api/sdk.gen.ts` and `types.gen.ts` are outputs — never hand-edit them.
- **Do not modify OpenClaw source.** `packages/slimclaw/runtime-seed/**` and `**/.dist-runtime/**` contain vendored/built code with WhatsApp references. Leave all of them alone.
- **Do not remove the `whatsapp` share target** in `packages/shared/src/schemas/rewards.ts` or the `wa.me` link in the rewards tests. That is a social-share feature, unrelated to the channel.
- **Do not touch `purgeExpiredWechatLogins`** (`channel-service.ts:402`) — it is WeChat, and it sits in the middle of the WhatsApp helper block.
- Required checks after each task: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Commit messages use `feat:` / `fix:` / `chore:` / `docs:`. **No `Co-Authored-By:` trailer.**

## File Structure

| File | Responsibility after this plan |
|---|---|
| `apps/controller/src/store/lowdb-store.ts` | Gains an optional `migrate` hook applied to raw JSON before schema validation |
| `apps/controller/src/store/nexu-config-store.ts` | Supplies the migration that drops legacy `whatsapp` channels; loses `connectWhatsapp` |
| `packages/shared/src/schemas/channel.ts` | Loses `whatsapp` from the enum and the three QR-flow schemas plus `connectWhatsappSchema` |
| `packages/shared/src/schemas/openclaw-config.ts` | Loses the WhatsApp channel/account/group schemas |
| `apps/controller/src/services/channel-service.ts` | Loses ~19 WhatsApp helpers and 4 methods (127 referencing lines) |
| `apps/controller/src/routes/channel-routes.ts` | Loses the three `/api/v1/channels/whatsapp/*` routes |
| `apps/controller/src/lib/channel-binding-compiler.ts` | Stops compiling WhatsApp accounts into OpenClaw config |
| `apps/controller/src/runtime/sessions-runtime.ts` | Stops detecting the WhatsApp session type |
| `apps/controller/src/runtime/slimclaw-runtime-plugin-writer.ts` | Drops `whatsapp` from the materialized plugin list |
| `apps/controller/scripts/bundle-runtime-plugins.mjs` | Drops the `whatsapp` bundle entry |
| `apps/web/src/**` | Loses the setup view, icon, links, tracking, i18n strings, and page entries |
| `docs/{en,ja,ko,zh}/guide/channels/whatsapp.md` | Deleted, with sidebar entries removed |

---

### Task 1: Pre-parse config migration that drops legacy WhatsApp channels

This task ships the safety net. It lands while `"whatsapp"` is still a valid enum value, so the migration is provably correct before anything depends on it.

**Files:**
- Modify: `apps/controller/src/store/lowdb-store.ts:4-15` (options interface), `:89-95` (`readAndParse`)
- Modify: `apps/controller/src/store/nexu-config-store.ts:672-675` (store construction)
- Test: `apps/controller/tests/nexu-config-store-whatsapp-migration.test.ts` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `LowDbStoreOptions<T>.migrate?: (raw: unknown) => unknown`, applied in `readAndParse` before `schema.parse`. Task 2 relies on this existing.

- [ ] **Step 1: Write the failing test**

Create `apps/controller/tests/nexu-config-store-whatsapp-migration.test.ts`:

```typescript
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LowDbStore } from "../src/store/lowdb-store.js";
import { z } from "zod";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.map((dir) => rm(dir, { recursive: true, force: true })),
  );
  tempRoots.length = 0;
});

const schema = z.object({
  channels: z.array(
    z.object({
      id: z.string(),
      channelType: z.enum(["feishu", "wecom"]),
    }),
  ),
});

describe("LowDbStore migrate hook", () => {
  it("drops entries the schema would reject instead of falling back to defaults", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "nexu-lowdb-migrate-"));
    tempRoots.push(dir);
    const filePath = path.join(dir, "config.json");

    await writeFile(
      filePath,
      JSON.stringify({
        channels: [
          { id: "keep", channelType: "feishu" },
          { id: "drop", channelType: "whatsapp" },
        ],
      }),
      "utf8",
    );

    const store = new LowDbStore(
      filePath,
      schema,
      () => ({ channels: [] }),
      {
        migrate: (raw) => {
          if (typeof raw !== "object" || raw === null) return raw;
          const record = raw as Record<string, unknown>;
          if (!Array.isArray(record.channels)) return raw;
          return {
            ...record,
            channels: record.channels.filter(
              (entry) =>
                typeof entry === "object" &&
                entry !== null &&
                (entry as Record<string, unknown>).channelType !== "whatsapp",
            ),
          };
        },
      },
    );

    const result = await store.read();

    expect(result.channels).toEqual([{ id: "keep", channelType: "feishu" }]);
  });

  it("leaves the file untouched when nothing needs migrating", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "nexu-lowdb-migrate-"));
    tempRoots.push(dir);
    const filePath = path.join(dir, "config.json");
    const payload = JSON.stringify({
      channels: [{ id: "keep", channelType: "feishu" }],
    });
    await writeFile(filePath, payload, "utf8");

    const store = new LowDbStore(filePath, schema, () => ({ channels: [] }), {
      migrate: (raw) => raw,
    });

    await store.read();

    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual(
      JSON.parse(payload),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run apps/controller/tests/nexu-config-store-whatsapp-migration.test.ts`
Expected: FAIL — `migrate` is not a recognized option, so the whatsapp entry reaches `schema.parse`, which throws and the store falls back to `{ channels: [] }`.

- [ ] **Step 3: Add the `migrate` hook to LowDbStore**

In `apps/controller/src/store/lowdb-store.ts`, extend the options interface:

```typescript
export interface LowDbStoreOptions<T> {
  /**
   * Applied on the way to disk and on the way back. Used to keep credentials
   * out of the file at rest while every caller above still sees plaintext.
   */
  transform?: {
    onWrite: (value: T) => T;
    onRead: (value: T) => T;
  };
  /**
   * Applied to raw parsed JSON *before* schema validation. Use it to drop or
   * rewrite persisted shapes the current schema no longer accepts. Without
   * this, a single unrecognized value sends `read()` down the
   * createDefault() path, which silently replaces the user's whole file.
   */
  migrate?: (raw: unknown) => unknown;
  /** POSIX mode for the persisted files. Credentials warrant 0o600. */
  fileMode?: number;
}
```

Apply it in `readAndParse`:

```typescript
  private async readAndParse(filePath: string): Promise<T> {
    const raw = await readFile(filePath, "utf8");
    const rawValue: unknown = JSON.parse(raw);
    const migrated = this.options.migrate
      ? this.options.migrate(rawValue)
      : rawValue;
    const parsed = this.schema.parse(migrated);
    return this.options.transform
      ? this.options.transform.onRead(parsed)
      : parsed;
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run apps/controller/tests/nexu-config-store-whatsapp-migration.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Wire the migration into the real config store**

In `apps/controller/src/store/nexu-config-store.ts`, add above the class:

```typescript
/**
 * Drops channel entries whose `channelType` this build no longer accepts.
 * WhatsApp was retired in v0.9.0; without this, `LowDbStore.read()` fails
 * validation on both the config and its backup and resets the user's whole
 * configuration to defaults.
 */
function dropRetiredChannels(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const record = raw as Record<string, unknown>;
  if (!Array.isArray(record.channels)) return raw;

  const kept = record.channels.filter((entry) => {
    if (typeof entry !== "object" || entry === null) return true;
    return (entry as Record<string, unknown>).channelType !== "whatsapp";
  });

  if (kept.length === record.channels.length) return raw;
  return { ...record, channels: kept };
}
```

Pass it to the store in the constructor (`nexu-config-store.ts:672`), alongside the existing `transform` option at line 724:

```typescript
        migrate: dropRetiredChannels,
```

- [ ] **Step 6: Verify the full suite still passes**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all pass. No behavior change yet — `whatsapp` is still a valid enum value, so `dropRetiredChannels` removes entries that would otherwise have loaded. That is intentional: the channel is going away in Task 2 and the plugin will already be gone from fresh installs.

- [ ] **Step 7: Commit**

```bash
git add apps/controller/src/store/lowdb-store.ts apps/controller/src/store/nexu-config-store.ts apps/controller/tests/nexu-config-store-whatsapp-migration.test.ts
git commit -m "feat(controller): drop retired channel entries before config validation"
```

---

### Task 2: Remove WhatsApp from shared schemas

**Files:**
- Modify: `packages/shared/src/schemas/channel.ts:11` (enum), `:75` (`connectWhatsappSchema`), `:199-228` (QR schemas), `:262`, `:278-286` (type exports)
- Modify: `packages/shared/src/schemas/openclaw-config.ts:414-433` (WhatsApp group/account/channel schemas)

**Interfaces:**
- Consumes: `dropRetiredChannels` from Task 1 — already protecting stored configs.
- Produces: `channelTypeSchema` without `"whatsapp"`. Tasks 3–5 remove the code that referenced the deleted symbols.

- [ ] **Step 1: Remove the enum member**

In `packages/shared/src/schemas/channel.ts`, delete the `"whatsapp",` line from `channelTypeSchema` (line 11). The enum becomes:

```typescript
  "discord",
  "feishu",
  "dingtalk",
  "wecom",
  "wechat",
  "telegram",
  "qqbot",
]);
```

- [ ] **Step 2: Delete the WhatsApp schemas and their type exports**

Delete these declarations entirely from `packages/shared/src/schemas/channel.ts`:
- `connectWhatsappSchema` (line 75)
- `whatsappQrWaitRequestSchema` (line 199)
- `whatsappQrStartResponseSchema` (line 215)
- `whatsappQrWaitResponseSchema` (line 222)
- `ConnectWhatsappInput` (line 262)
- `WhatsappQrWaitRequest` (line 278)
- `WhatsappQrStartResponse` (line 281)
- `WhatsappQrWaitResponse` (line 284)

- [ ] **Step 3: Delete the OpenClaw config schemas**

In `packages/shared/src/schemas/openclaw-config.ts`, delete `whatsappGroupSchema` (line 414), `whatsappAccountSchema` (line 420), and `whatsappChannelSchema` (line 433), plus the `whatsapp` key wherever the channels object composes them.

- [ ] **Step 4: Rebuild shared and observe the expected breakage**

Run: `pnpm --filter @nexu/shared build && pnpm typecheck`
Expected: FAIL. Errors point at `channel-service.ts`, `channel-routes.ts`, `channel-binding-compiler.ts`, and the web files — exactly the call sites Tasks 3 and 4 remove. Record the error list; it is the checklist for the next two tasks.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/schemas/channel.ts packages/shared/src/schemas/openclaw-config.ts
git commit -m "feat(shared): remove whatsapp channel schemas"
```

Committing with `typecheck` red is intentional here — Tasks 2–4 form one logical removal and the tree is green again at the end of Task 4. If your workflow forbids red intermediate commits, do Tasks 2, 3, and 4 as a single commit instead.

---

### Task 3: Remove WhatsApp from the controller

**Files:**
- Modify: `apps/controller/src/services/channel-service.ts` — delete the helper block and methods listed below
- Modify: `apps/controller/src/routes/channel-routes.ts:15,25-27,1075-1190` — three routes and their imports
- Modify: `apps/controller/src/lib/channel-binding-compiler.ts:97,184-186,306-307,376-389`
- Modify: `apps/controller/src/runtime/sessions-runtime.ts:2826-2830`
- Modify: `apps/controller/src/runtime/slimclaw-runtime-plugin-writer.ts:24`
- Modify: `apps/controller/src/store/nexu-config-store.ts:1746-1762` (`connectWhatsapp`)
- Modify: `apps/controller/src/services/openclaw-gateway-service.ts`, `apps/controller/src/services/analytics-service.ts` (one reference each)
- Test: `apps/controller/tests/sessions-runtime.test.ts`, `apps/controller/tests/slimclaw-runtime-plugin-writer.test.ts` — drop WhatsApp cases

**Interfaces:**
- Consumes: the deleted schema symbols from Task 2.
- Produces: a controller with no WhatsApp surface. Task 4 removes the web callers of the deleted routes.

- [ ] **Step 1: Delete the WhatsApp helpers in `channel-service.ts`**

Delete these top-level declarations. They are contiguous except where noted:

`activeWhatsappLogins` (150), `extractWhatsappStatusCode` (152), `normalizeWhatsappSelfJid` (191), `normalizeWhatsappSelfE164` (198), `readWhatsappLoginIdentity` (209), `matchesWhatsappIdentity` (229), `resolveWhatsAppAccountDir` (272), `resolveWhatsAppLoginSessionDir` (284), `isTemporaryWhatsAppAuthDir` (291), `resolveWhatsAppLoginSessionRoot` (295), `closeWhatsappSocket` (411), `isWhatsappLoginFresh` (419), `resetActiveWhatsappLogin` (423), `attachWhatsappLoginWaiter` (446), `restartWhatsappLoginSocket` (497), `loadWhatsappRuntimeModules` (570).

**`purgeExpiredWechatLogins` at line 402 sits inside this range and is WeChat. Keep it.**

- [ ] **Step 2: Delete the WhatsApp methods and their types**

Delete `whatsappQrStart()` (1323), `whatsappQrWait()` (1417), `connectWhatsapp()` (1512), `waitForWhatsappReady()` (1646), and `restartOpenClawForWhatsappLifecycle`. Delete the `ActiveWhatsappLogin` interface and the `WaSocket` type import. In `disconnect` (~1623), delete the `channel?.channelType === "whatsapp"` branch.

- [ ] **Step 3: Delete the routes**

In `apps/controller/src/routes/channel-routes.ts`, delete the three `createRoute()` + `app.openapi()` pairs for `/api/v1/channels/whatsapp/qr-start` (1075), `/qr-wait` (1110), and `/connect` (1159), plus the four schema imports at lines 15 and 25-27.

- [ ] **Step 4: Delete the remaining controller references**

- `channel-binding-compiler.ts`: delete `whatsappAccounts` (97), the `channelType === "whatsapp"` branch (184-186), the count (306-307), and the config block (376-389).
- `sessions-runtime.ts`: delete the `whatsapp` / `@s.whatsapp.net` detection branch (2826-2830).
- `slimclaw-runtime-plugin-writer.ts`: delete `"whatsapp",` from the plugin list (24).
- `nexu-config-store.ts`: delete `connectWhatsapp()` (1746-1762).
- `openclaw-gateway-service.ts` and `analytics-service.ts`: delete the single WhatsApp reference in each.

- [ ] **Step 5: Update the controller tests**

Remove the WhatsApp cases from `apps/controller/tests/sessions-runtime.test.ts` (8 references) and `apps/controller/tests/slimclaw-runtime-plugin-writer.test.ts` (6 references). Do not weaken the surrounding assertions — delete only the WhatsApp rows and expectations.

- [ ] **Step 6: Regenerate the SDK**

Run: `pnpm generate-types`
Expected: `apps/controller/openapi.json`, `apps/web/lib/api/sdk.gen.ts`, and `types.gen.ts` all lose their WhatsApp entries. Do not hand-edit these files.

- [ ] **Step 7: Verify the controller compiles**

Run: `pnpm --filter @nexu/controller typecheck`
Expected: PASS. Remaining `pnpm typecheck` failures should be confined to `apps/web` — Task 4's scope.

- [ ] **Step 8: Commit**

```bash
git add apps/controller packages/shared apps/web/lib/api
git commit -m "feat(controller): remove whatsapp channel service, routes, and compilation"
```

---

### Task 4: Remove WhatsApp from the web app

**Files:**
- Delete: `apps/web/src/components/channel-setup/whatsapp-setup-view.tsx`, `apps/web/src/lib/whatsapp.ts`
- Modify: `apps/web/src/pages/home.tsx` (23 refs), `channels.tsx` (5), `sessions.tsx` (4)
- Modify: `apps/web/src/components/platform-icons.tsx:15,151-154,230-231`, `activity-feed.tsx:47`
- Modify: `apps/web/src/lib/channel-links.ts:68-69`, `lib/tracking.ts`, `layouts/workspace-layout.tsx`
- Modify: `apps/web/src/i18n/locales/en.ts` and `zh-CN.ts` — delete the `whatsappSetup` block and any `whatsapp` channel label (24 refs each)
- Test: `apps/web/tests/{sessions,workspace-layout,activity-feed,home,channels-error-states}.test.tsx`

**Interfaces:**
- Consumes: the regenerated SDK from Task 3 — the WhatsApp SDK functions no longer exist.
- Produces: a web app with no WhatsApp surface. No later task depends on this.

- [ ] **Step 1: Delete the two WhatsApp-only files**

```bash
git rm apps/web/src/components/channel-setup/whatsapp-setup-view.tsx apps/web/src/lib/whatsapp.ts
```

- [ ] **Step 2: Remove the channel entry and its wiring**

Delete the `whatsapp` case/entry from `platform-icons.tsx` (the union member at line 15, `WhatsAppIcon` at 151, and the `case "whatsapp"` at 230), `activity-feed.tsx:47`, and `channel-links.ts:68-69`. Delete the WhatsApp routing and setup-view registration from `channels.tsx`, `home.tsx`, `sessions.tsx`, `workspace-layout.tsx`, and `tracking.ts`.

- [ ] **Step 3: Remove the i18n strings**

Delete the whole `whatsappSetup` block and any `whatsapp` channel-name entry from both `apps/web/src/i18n/locales/en.ts` and `apps/web/src/i18n/locales/zh-CN.ts`. Both files must lose the same keys — a key present in one locale but not the other is a lint failure.

- [ ] **Step 4: Update the web tests**

Remove WhatsApp cases from `apps/web/tests/sessions.test.tsx` (21 refs), `workspace-layout.test.tsx` (6), `activity-feed.test.tsx` (6), `home.test.tsx` (3), and `channels-error-states.test.tsx` (2). Delete only the WhatsApp rows; leave the surrounding coverage intact.

- [ ] **Step 5: Verify the whole tree is green**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all PASS. This is the first point since Task 2 where the tree is fully green.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): remove whatsapp channel UI"
```

---

### Task 5: Drop the bundled plugin and its dependencies

This is the task that actually reclaims the 40 MB.

**Files:**
- Modify: `apps/controller/scripts/bundle-runtime-plugins.mjs:40-43`
- Modify: `package.json` — remove `@openclaw/whatsapp` and `silk-wasm`

**Interfaces:**
- Consumes: nothing — independent of Tasks 2–4, but pointless before them.
- Produces: a `.dist-runtime/plugins/` tree with no `whatsapp` directory. The follow-on plan `2026-08-07-plugin-dependency-hoisting.md` assumes this.

- [ ] **Step 1: Remove the bundle entry**

In `apps/controller/scripts/bundle-runtime-plugins.mjs`, delete this entry from `bundledPlugins` (lines 40-43):

```javascript
  {
    id: "whatsapp",
    npmName: "@openclaw/whatsapp",
  },
```

- [ ] **Step 2: Remove the dependencies**

In the root `package.json`, delete the `"@openclaw/whatsapp"` and `"silk-wasm"` entries.

`silk-wasm` was added in v0.6.2 alongside the WhatsApp plugin. Confirm nothing else needs it before removing:

Run: `grep -rn "silk-wasm" --include="*.ts" --include="*.tsx" --include="*.mjs" --include="*.json" apps/ packages/ | grep -v node_modules | grep -v pnpm-lock`
Expected: only the root `package.json` line you are deleting. **If `qqbot` or any other plugin appears, keep `silk-wasm`** — it was originally added to satisfy a `qqbot-nodejs` optional peer (see commit `20729daa`).

- [ ] **Step 3: Reinstall and rebuild the plugin bundle**

```bash
pnpm install
pnpm --filter @nexu/controller exec node scripts/bundle-runtime-plugins.mjs
```

- [ ] **Step 4: Verify the plugin is gone and measure the reduction**

```bash
test ! -d apps/controller/.dist-runtime/plugins/whatsapp && echo "whatsapp plugin removed"
du -sh apps/controller/.dist-runtime/plugins
```

Expected: the confirmation line prints, and the plugins directory is roughly 67 MB, down from 107 MB.

- [ ] **Step 5: Verify the dependency-contract scan is clean**

The WhatsApp plugin carried two of the three known violations. Confirm both are gone:

```bash
node /private/tmp/claude-501/-Users-zongkelong-workspace-nexu/6cd4989f-a321-4f14-9358-88b57168ae74/scratchpad/find-dropped-versions.mjs
```

Expected: only the dingtalk `form-data@^4.0.5 -> 4.0.0` violation remains. That one is fixed by the follow-on hoisting plan. If the scratchpad script is gone, this step is informational only — skip it.

- [ ] **Step 6: Run the full checks**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml apps/controller/scripts/bundle-runtime-plugins.mjs
git commit -m "feat: drop the bundled whatsapp plugin"
```

---

### Task 6: Remove the documentation

**Files:**
- Delete: `docs/{en,ja,ko,zh}/guide/channels/whatsapp.md`, `docs/public/assets/whatsapp/` (7 assets)
- Modify: `docs/.vitepress/config.ts:132,192,253,314` (four sidebar entries)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. Terminal task.

- [ ] **Step 1: Delete the pages and assets**

```bash
git rm docs/en/guide/channels/whatsapp.md docs/ja/guide/channels/whatsapp.md docs/ko/guide/channels/whatsapp.md docs/zh/guide/channels/whatsapp.md
git rm -r docs/public/assets/whatsapp
```

- [ ] **Step 2: Remove the sidebar entries**

In `docs/.vitepress/config.ts`, delete the WhatsApp entry from each of the four language sidebars (lines 132, 192, 253, 314 — delete from the bottom up so earlier line numbers stay valid):

```typescript
          { text: "WhatsApp", link: "/guide/channels/whatsapp" },
```

- [ ] **Step 3: Check for dangling links**

Run: `grep -rn "channels/whatsapp" docs/ | grep -v node_modules`
Expected: no output. If any page still links to the removed guide, delete that link too.

- [ ] **Step 4: Verify the docs build**

Run: `pnpm --filter @nexu/docs build`
Expected: PASS with no dead-link warnings. If the docs package has a different name, check `docs/package.json`.

- [ ] **Step 5: Commit**

```bash
git add docs
git commit -m "docs: remove whatsapp channel guide"
```

---

## Final verification

- [ ] `pnpm typecheck && pnpm lint && pnpm test` — all green
- [ ] `grep -rn "whatsapp" apps/ packages/ --include="*.ts" --include="*.tsx" --include="*.mjs" | grep -viE "rewards|wa\.me" | grep -vE "\.dist-runtime|runtime-seed|node_modules|/dist/"` returns nothing except the `dropRetiredChannels` migration in `nexu-config-store.ts`, which must stay.
- [ ] Manual: package a DMG (`pnpm dist:mac:unsigned:arm64`) and compare against v0.8.0's 346 MB.
- [ ] Manual: launch with a config containing a legacy `whatsapp` channel and confirm the app starts, that channel is gone, and **every other bot, channel, and model provider survives**. This is the regression that Task 1 exists to prevent — do not skip it.
