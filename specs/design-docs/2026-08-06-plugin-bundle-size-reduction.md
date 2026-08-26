# Plugin Bundle Size Reduction

Date: 2026-08-06
Status: Design — not yet implemented

## TL;DR

The macOS DMG grew from 262 MB (v0.5.0) to 346 MB (v0.8.0). The growth is three discrete steps, not gradual drift. Of the current payload, `controller/plugins` is the single largest item at 107 MB, and a measurable slice of that is pure duplication: the plugin bundler gives every plugin its own flat `node_modules`, so `zod@4.3.6` ships four times.

This design makes three changes to `apps/controller/scripts/bundle-runtime-plugins.mjs` and the channel connect flow:

1. **Hoist cross-plugin identical versions** to a shared `node_modules` — 19.4 MB uncompressed.
2. **Stop silently dropping conflicting versions** during flattening — fixes a live dependency-contract violation and prevents the class from recurring.
3. **Retire the WhatsApp channel entirely** — 40 MB uncompressed.

All byte figures in this document are **uncompressed** `du` measurements. The DMG is compressed, so the shipped reduction will be materially smaller. Post-build comparison is required to state the real number.

## Where the size went

DMG size by release (arm64):

| Version | Size | Delta | Cause |
|---|---|---|---|
| v0.5.0 – v0.5.12 | 262–263 MB | baseline | |
| **v0.5.13** | 276 MB | **+13** | `electron ^37.2.5 → ^43.0.0` |
| v0.6.0 – v0.6.1 | 275–277 MB | — | |
| **v0.6.2** | 313 MB | **+36** | `@openclaw/whatsapp` + `silk-wasm` added; qqbot/lark/dingtalk/wecom upgraded |
| v0.6.4 – v0.6.6 | 312 MB | — | |
| **v0.6.7** | 345 MB | **+33** | `prepare:officecli-runtime` + `prepare:computer-use-sidecar` added |
| v0.7.0 – v0.8.0 | 342–346 MB | — | |

Current payload, measured from a local `.dist-runtime` (279 MB total):

```
controller  173M  ├─ plugins       107M
                  ├─ node_modules   61M
                  └─ dist          4.2M
openclaw     47M
tools        32M  └─ officecli      32M
web          28M
```

`controller/plugins` breakdown: whatsapp 40M, openclaw-lark 26M, dingtalk-connector 18M, wecom 12M, openclaw-weixin 5.5M, tabby-control 4.5M, openclaw-qqbot 2.7M.

## Change 1 — Hoist identical versions across plugins

### Mechanism

`bundle-runtime-plugins.mjs` copies each plugin to `.dist-runtime/plugins/<id>/` and flattens its full dependency closure into `<id>/node_modules/`. Nothing is shared across plugins, so identical packages are copied once per plugin.

At runtime `slimclaw-runtime-plugin-writer.ts` copies each `<id>` directory to `<openclawStateDir>/extensions/<id>/`. Node resolves from `extensions/<id>/` upward: `extensions/<id>/node_modules` → `extensions/node_modules` → …

So a shared `node_modules` at the plugins root is resolved by plain Node semantics. **No plugin code changes, no OpenClaw changes.**

### Only identical versions are hoisted

The bundler compares exact version strings. A package is hoisted only when every plugin carrying it has the byte-identical version; any package with more than one version in play stays nested in each plugin, unchanged.

This is deliberately narrower than semver-range unification. Range-aware unification was measured at 21.4 MB versus 19.4 MB — 2.1 MB more — but it requires resolving declared ranges across the whole dependency graph, needs a `semver` dependency, and can silently downgrade a package whose real constraint lives deeper than the analysis walked. The extra 2.1 MB does not justify that risk. Identical-version hoisting cannot change which version any plugin resolves.

### Measured savings

| Package | Copies | Per copy | Saved |
|---|---|---|---|
| `zod@4.3.6` | 4 | 4.8 MB | 14.2 MB |
| `axios@1.14.0` | 2 | 1.1 MB | 1.1 MB |
| 42 smaller packages | 2–6 | < 1 MB each | 4.1 MB |
| **Total** | | | **19.4 MB** |

### Packages that stay duplicated

Four packages exist at more than one version and are therefore out of scope:

| Package | Versions | Blocking declarer |
|---|---|---|
| `zod` | 4.3.6 / 3.25.76 | `@youngclaw/tabby-control` declares `^3.23.8` |
| `axios` | 1.14.0 / 1.13.6 | `@larksuiteoapi/node-sdk` declares `~1.13.3` |
| `form-data` | 4.0.0 / 4.0.5 | `@dingtalk-real-ai/dingtalk-connector` pins exactly `4.0.0` |
| `proxy-from-env` | 2.1.0 / 1.1.0 | no independent declarer — downstream of the `axios` split |

`ws` is a near miss worth recording: all six declarers use caret ranges (`^8.13.0`, `^8.19.0`, `^8.21.0`, `^8.16.0`) and `8.21.1` satisfies all of them, so it *is* unifiable — but at 196 KB per copy the whole win is ~1 MB, which does not justify range-aware machinery.

### Placement constraint

The shared directory must be named `node_modules`. Two other names are actively dangerous: OpenClaw's `plugin-dependency-cleanup` treats `plugin-runtime-deps` and `bundled-plugin-runtime-deps` as legacy debris and deletes them.

`extensions/node_modules/` is verified safe:

- `listInstalledPluginDirs` filters `node_modules` out of plugin discovery via `IGNORED_INSTALLED_PLUGIN_DIR_NAMES`.
- `collectLegacyExtensionDebris` deletes a `node_modules` child only when its sibling set contains a `.openclaw-runtime-deps*` marker file. We create no such marker.
- That cleanup runs under `openclaw doctor`, not on the normal startup path.

## Change 2 — Stop dropping conflicting versions when flattening

### The bug

When flattening a plugin's dependency closure, the bundler deduplicates by package **name**:

```js
if (copiedNames.has(packageName)) continue;
```

When the source layout legitimately contains two versions of one package — which is exactly how npm and pnpm express conflicting constraints — whichever is encountered first wins and the other is discarded. The plugin then runs against a version that does not satisfy its declared range.

Two instances were found, both verified against the source layout:

| Plugin | Declarer | Requires | Gets | Dropped copy |
|---|---|---|---|---|
| dingtalk-connector | `axios@1.14.0` | `form-data@^4.0.5` | 4.0.0 | pnpm store has both 4.0.0 and 4.0.5; axios nests 4.0.5 |
| whatsapp | `qified` | `hookified@^2.1.1` | 1.15.1 | vendored tree has `qified/node_modules/hookified@2.2.0` |

The WhatsApp instance disappears with Change 3, leaving one live violation. It is recorded here because it is the clearer demonstration of the mechanism — a major-version mismatch produced purely by flattening — and because the class recurs with every channel plugin added.

### Why per-package overrides were rejected

A pnpm `overrides` entry fixes the dingtalk case, but the mechanism does not generalize: in the WhatsApp case the top-level `hookified@1.15.1` was required by a different consumer, so forcing it to 2.2.0 would have broken that consumer. Nesting is the reason such a conflict is expressible at all. `overrides` also applies repo-wide, a much larger blast radius than a bundler-local change, and it treats each occurrence one at a time instead of removing the defect.

### Fix

Replace name-based deduplication with name+version deduplication. When a second version of an already-copied package is encountered, nest it under the declarer that requires it (`<plugin>/node_modules/<declarer>/node_modules/<dep>`) rather than discarding it — the layout npm and pnpm already use.

Size cost is a few hundred KB: the packages involved (`form-data` 56 KB, `hookified`) are small. This is a correctness change that happens to cost size, not a size change.

### Out of scope: an upstream defect

A third violation was found and is **not** ours: `music-metadata` requires `file-type@^21.3.4` but gets 22.0.1. `@openclaw/whatsapp` ships 22.0.1 at the top level of its vendored tree with no nested copy for `music-metadata`, so the mismatch exists before our bundler runs. Change 3 removes that plugin, so this stops applying — recorded only so a future reintroduction of the plugin does not treat it as a regression in our bundler.

## Change 3 — Retire the WhatsApp channel

WhatsApp is being withdrawn as a product decision: the plugin is 40 MB — the largest single item under `controller/plugins` — and the channel is not needed for the product's actual audience.

### Scope

WhatsApp is a first-class channel, not merely a bundled dependency. A partial removal is worse than none: dropping only the bundled plugin would leave the connect UI, the QR pairing flow, and the API routes in place, all failing at the point of use. The removal therefore covers every layer:

| Layer | What goes |
|---|---|
| Bundle | `whatsapp` entry in `bundledPlugins`; `@openclaw/whatsapp` and `silk-wasm` from the root `package.json` |
| Runtime | `whatsapp` in `slimclaw-runtime-plugin-writer.ts`; account compilation in `channel-binding-compiler.ts`; session-type detection in `sessions-runtime.ts` |
| API | QR start/wait routes and their handlers in `channel-routes.ts` (12 references) |
| Schemas | `whatsapp` in the channel-type enum and the three QR-flow schemas in `packages/shared/src/schemas/channel.ts`; the WhatsApp block in `openclaw-config.ts` |
| Web | `whatsapp-setup-view.tsx`, the platform icon, the activity-feed label, `channel-links.ts`, and associated i18n strings — 12 files |
| Docs | `guide/channels/whatsapp.md` in en/ja/ko/zh, the 7 screenshot assets, and the four VitePress sidebar entries |

Regenerate the SDK (`pnpm generate-types`) after the route and schema changes.

Unrelated WhatsApp references stay: the `whatsapp` share target in `rewards.ts` and its `wa.me` link are a social-share feature, not a channel.

### Existing connections

Users who have a WhatsApp channel connected will find it gone after updating, and the channel-type enum will no longer accept the stored value. Config carrying a `whatsapp` channel must be handled deliberately rather than left to throw a validation error at load: drop such entries during config read and log the drop. Whether to also surface a one-time in-app notice is a product call, not a technical one, and is left open.

### What this removes for free

Both WhatsApp dependency defects disappear with the plugin: the `qified`/`hookified` violation caused by our flattening, and the upstream `music-metadata`/`file-type` mismatch. Neither needs any further work.

### Reversibility

This is a deletion, recoverable from git history but not from a runtime toggle. It was chosen over an on-demand download — which would have kept the channel working for overseas users at the cost of a tarball build step, an object-storage host decision, and runtime download/verify/extract code — because the channel is not wanted at all.

## Non-goals

- **Unifying `zod` to a single version.** Would require migrating `@youngclaw/tabby-control` from zod 3 to 4 — a cross-repo major upgrade touching 33 `.default()` call sites and 2 `z.record()` sites, then republishing and regression-testing device control. Worth 3.9 MB uncompressed (~1 MB in the DMG). Do it when that repo is being worked on for other reasons. Note the controller itself **cannot** move to zod 4: `@hono/zod-openapi@0.18.4` declares `peerDependencies: { zod: "3.*" }`. This does not block plugin-side hoisting — controller and plugins are separate resolution roots.
- **Forcing `axios` to one version** via pnpm `overrides`. 1.1 MB, and it overrides a patch-level pin the Lark SDK set deliberately.
- **The `pdf-parse` / officecli / computer-use payloads.** Larger opportunities (46 MB and 32 MB respectively) but separate work.

## Testing

- `bundle-runtime-plugins.test.ts`: identical versions across plugins hoist to the shared root; a package present at two versions stays nested in both plugins and neither plugin's resolved version changes.
- `bundle-runtime-plugins.test.ts`: a source tree containing two versions of one package produces both in the output, nested correctly — a regression test for the dropped-version bug, built on the dingtalk `form-data` shape.
- A build-time assertion that walks the bundled output and fails if any package's resolved version violates a declared range, so this class cannot regress silently. With WhatsApp gone this should pass with no allowlist; if an entry ever becomes necessary it must carry a comment naming the upstream defect.
- WhatsApp removal: `pnpm typecheck` and `pnpm lint` catch the code paths, but add an explicit test that config containing a legacy `whatsapp` channel loads without throwing and drops the entry.
- Manual: package a DMG and compare against v0.8.0's 346 MB to obtain the real compressed reduction. Smoke-test every remaining channel, since all of them now resolve shared dependencies through a new path.

## Risks

- **Hoisting changes dependency resolution for every channel plugin at once.** Identical-version-only hoisting makes this semantically inert in theory, but all channels need a smoke test before release.
- **`extensions/node_modules/` is safe against OpenClaw's current scanner and cleanup**, verified by reading the prepared runtime. A future OpenClaw version could change either. The build-time assertion above does not cover this; the channel smoke test does.
- **WhatsApp removal is user-facing and irreversible in a release.** Users with a connected WhatsApp channel lose it on update, and the product ships docs in en/ja/ko/zh, so the affected users are not only the domestic ones the decision was made for. Accepted deliberately.
- **The removal touches API routes and shared schemas**, so the generated SDK and every call site move with it. `pnpm generate-types` + `pnpm typecheck` are the gate; a missed reference is a build failure rather than a silent defect.
