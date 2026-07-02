# tabby-image 生图 Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a new SkillHub-installable skill, `tabby-image`, that lets a bot generate images through the user's own logged-in Tabby cloud account (model `tabby-image` / `tabby-image-free`, served by `tabbyapi.picaso.studio`) — no separate API key setup.

**Architecture:** A pure-Node ESM CLI script (`scripts/generate-image.js`) reads the already-compiled `$OPENCLAW_STATE_DIR/openclaw.json`, pulls `models.providers.link.{baseUrl,apiKey}` (this is the same credential OpenClaw itself uses for chat completions), calls `POST {baseUrl}/images/generations`, writes the result to the standard `media/outbound/{slugid}/tabby-image/` location, and prints a `MEDIA:` line so the bot can attach it to its reply. Credential resolution and response parsing are extracted into a separate pure module (`scripts/lib.js`) so they're unit-testable without network access. The skill ships in two copies — a repo-root source mirror (`skills/nexubot/tabby-image/`) and the production bundle (`apps/desktop/static/bundled-skills/tabby-image/`) — matching the existing `nano-banana-one-shop` pattern, registered via `STATIC_SKILL_SLUGS`.

**Tech Stack:** Node.js ESM, `node:util` `parseArgs`, `node:test` + `node:assert/strict` for unit tests, no external npm dependencies.

## Global Constraints

- Do not modify `apps/controller/src/lib/openclaw-config-compiler.ts`, any bot schema, or the web model picker — `tabby-image` already reaches `models.providers.link` through the existing cloud-model sync path.
- Do not modify OpenClaw source code (repo-wide hard rule, see `AGENTS.md`).
- No new controller HTTP endpoints, no云端 secrets calls — credential comes from the local `openclaw.json` file only.
- v1 scope is text-to-image only (`images/generations`). Do not implement `images/edits` — the design doc (`specs/design-docs/2026-07-02-tabby-image-skill.md`, §6) records that the gateway was returning 500s on *every* endpoint (including basic chat completions) during design, so the edits route could not be verified to exist.
- Match the existing `nano-banana-one-shop` conventions exactly where they apply: `MEDIA: <absolute-path>` stdout line, `$OPENCLAW_STATE_DIR/media/outbound/{slugid}/{skill-name}/{filename}` output path (`slugid = path.basename(process.cwd())`), `console.error` + `process.exit(1)` on failure, double-quote/semicolon style (Biome default in this repo).
- `pnpm lint` and `pnpm typecheck` must stay clean after every task — `skills/**` and `apps/desktop/static/bundled-skills/**` are both linted by Biome (not in `biome.json`'s `files.ignore` list).

---

### Task 1: Credential resolution + response parsing library (TDD)

**Files:**
- Create: `skills/nexubot/tabby-image/scripts/lib.js`
- Create: `skills/nexubot/tabby-image/scripts/lib.test.js`

**Interfaces:**
- Produces (consumed by Task 2):
  - `readOpenclawConfig(stateDir: string | undefined): object` — throws `Error` with message prefixed `ENV_MISSING:` or `CONFIG_MISSING:` or `CONFIG_INVALID:` on failure.
  - `resolveLinkCredential(config: object): { baseUrl: string, apiKey: string, model: string }` — throws `Error` prefixed `NOT_LOGGED_IN:` or `NO_IMAGE_MODEL:` on failure.
  - `parseImageResponse(body: object): { kind: "b64" | "url", data: string }` — throws `Error` prefixed `BAD_RESPONSE:` on failure.
  - `resolveOutputPath(opts: { stateDir: string, cwd: string, filename: string, skillName: string }): string`

- [ ] **Step 1: Write the failing tests**

Create `skills/nexubot/tabby-image/scripts/lib.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  readOpenclawConfig,
  resolveLinkCredential,
  parseImageResponse,
  resolveOutputPath,
} from "./lib.js";

test("readOpenclawConfig throws ENV_MISSING when stateDir is falsy", () => {
  assert.throws(() => readOpenclawConfig(undefined), /ENV_MISSING/);
});

test("readOpenclawConfig throws CONFIG_MISSING when the file does not exist", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tabby-image-test-"));
  assert.throws(() => readOpenclawConfig(dir), /CONFIG_MISSING/);
});

test("readOpenclawConfig throws CONFIG_INVALID on unparsable JSON", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tabby-image-test-"));
  fs.writeFileSync(path.join(dir, "openclaw.json"), "{not json");
  assert.throws(() => readOpenclawConfig(dir), /CONFIG_INVALID/);
});

test("readOpenclawConfig parses a valid config file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tabby-image-test-"));
  fs.writeFileSync(path.join(dir, "openclaw.json"), JSON.stringify({ foo: "bar" }));
  const config = readOpenclawConfig(dir);
  assert.equal(config.foo, "bar");
});

test("resolveLinkCredential throws NOT_LOGGED_IN when the link provider is missing", () => {
  assert.throws(() => resolveLinkCredential({}), /NOT_LOGGED_IN/);
});

test("resolveLinkCredential throws NOT_LOGGED_IN when apiKey is empty", () => {
  const config = {
    models: { providers: { link: { baseUrl: "https://x/v1", apiKey: "", models: [] } } },
  };
  assert.throws(() => resolveLinkCredential(config), /NOT_LOGGED_IN/);
});

test("resolveLinkCredential throws NO_IMAGE_MODEL when neither variant is present", () => {
  const config = {
    models: {
      providers: {
        link: {
          baseUrl: "https://x/v1",
          apiKey: "key123",
          models: [{ id: "gpt-5.5" }, { id: "deepseek-v4-pro" }],
        },
      },
    },
  };
  assert.throws(() => resolveLinkCredential(config), /NO_IMAGE_MODEL/);
});

test("resolveLinkCredential prefers tabby-image over tabby-image-free", () => {
  const config = {
    models: {
      providers: {
        link: {
          baseUrl: "https://x/v1",
          apiKey: "key123",
          models: [{ id: "tabby-image-free" }, { id: "tabby-image" }],
        },
      },
    },
  };
  const result = resolveLinkCredential(config);
  assert.equal(result.model, "tabby-image");
  assert.equal(result.baseUrl, "https://x/v1");
  assert.equal(result.apiKey, "key123");
});

test("resolveLinkCredential falls back to tabby-image-free", () => {
  const config = {
    models: {
      providers: {
        link: {
          baseUrl: "https://x/v1",
          apiKey: "key123",
          models: [{ id: "tabby-image-free" }],
        },
      },
    },
  };
  const result = resolveLinkCredential(config);
  assert.equal(result.model, "tabby-image-free");
});

test("parseImageResponse returns a b64 payload when present", () => {
  const result = parseImageResponse({ data: [{ b64_json: "abc123" }] });
  assert.deepEqual(result, { kind: "b64", data: "abc123" });
});

test("parseImageResponse returns a url when b64_json is absent", () => {
  const result = parseImageResponse({ data: [{ url: "https://example.com/img.png" }] });
  assert.deepEqual(result, { kind: "url", data: "https://example.com/img.png" });
});

test("parseImageResponse throws BAD_RESPONSE when neither field is present", () => {
  assert.throws(() => parseImageResponse({ data: [{}] }), /BAD_RESPONSE/);
});

test("parseImageResponse throws BAD_RESPONSE when the data array is empty", () => {
  assert.throws(() => parseImageResponse({ data: [] }), /BAD_RESPONSE/);
});

test("resolveOutputPath returns an absolute filename as-is", () => {
  const result = resolveOutputPath({
    stateDir: "/state",
    cwd: "/workspace/my-bot",
    filename: "/tmp/out.png",
    skillName: "tabby-image",
  });
  assert.equal(result, "/tmp/out.png");
});

test("resolveOutputPath builds the outbound media path for relative filenames", () => {
  const result = resolveOutputPath({
    stateDir: "/state",
    cwd: "/workspace/my-bot",
    filename: "cat.png",
    skillName: "tabby-image",
  });
  assert.equal(
    result,
    path.join("/state", "media", "outbound", "my-bot", "tabby-image", "cat.png"),
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test skills/nexubot/tabby-image/scripts/lib.test.js`
Expected: FAIL — `Cannot find module './lib.js'` (the file doesn't exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `skills/nexubot/tabby-image/scripts/lib.js`:

```js
import fs from "node:fs";
import path from "node:path";

const IMAGE_MODEL_IDS = ["tabby-image", "tabby-image-free"];

/**
 * Read and parse the OpenClaw config compiled by the Nexu controller.
 * Throws if OPENCLAW_STATE_DIR is unset or the file is missing/unparsable.
 */
export function readOpenclawConfig(stateDir) {
  if (!stateDir) {
    throw new Error(
      "ENV_MISSING: OPENCLAW_STATE_DIR is not set. This script must run inside an OpenClaw skill execution.",
    );
  }
  const configPath = path.join(stateDir, "openclaw.json");
  if (!fs.existsSync(configPath)) {
    throw new Error(`CONFIG_MISSING: ${configPath} does not exist.`);
  }
  const raw = fs.readFileSync(configPath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`CONFIG_INVALID: failed to parse ${configPath}: ${err.message}`);
  }
}

/**
 * Pick the tabby-image credential and model id out of an already-parsed
 * openclaw.json config object. Prefers "tabby-image" over "tabby-image-free"
 * when both are present on the account.
 */
export function resolveLinkCredential(config) {
  const link = config?.models?.providers?.link;
  if (!link || typeof link.apiKey !== "string" || link.apiKey.length === 0) {
    throw new Error(
      "NOT_LOGGED_IN: No Tabby cloud credential found. Log into your official Tabby account in the desktop app, then try again.",
    );
  }
  if (typeof link.baseUrl !== "string" || link.baseUrl.length === 0) {
    throw new Error(
      "NOT_LOGGED_IN: No Tabby cloud credential found. Log into your official Tabby account in the desktop app, then try again.",
    );
  }

  const availableIds = new Set((link.models || []).map((m) => m.id));
  const model = IMAGE_MODEL_IDS.find((id) => availableIds.has(id));
  if (!model) {
    throw new Error(
      "NO_IMAGE_MODEL: Your Tabby account does not have access to the tabby-image model.",
    );
  }

  return { baseUrl: link.baseUrl, apiKey: link.apiKey, model };
}

/**
 * Extract the generated image from an OpenAI-compatible images/generations
 * response body. Returns a base64 payload or a URL to download.
 */
export function parseImageResponse(body) {
  const entry = body?.data?.[0];
  if (entry && typeof entry.b64_json === "string" && entry.b64_json.length > 0) {
    return { kind: "b64", data: entry.b64_json };
  }
  if (entry && typeof entry.url === "string" && entry.url.length > 0) {
    return { kind: "url", data: entry.url };
  }
  throw new Error(
    `BAD_RESPONSE: Gateway response did not contain an image. Body: ${JSON.stringify(body).slice(0, 200)}`,
  );
}

/**
 * Compute the absolute output path for a generated image, following the
 * same $OPENCLAW_STATE_DIR/media/outbound/{slugid}/{skillName}/{filename}
 * convention used by the nano-banana skill.
 */
export function resolveOutputPath({ stateDir, cwd, filename, skillName }) {
  if (path.isAbsolute(filename)) {
    return filename;
  }
  return path.join(stateDir, "media", "outbound", path.basename(cwd), skillName, filename);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test skills/nexubot/tabby-image/scripts/lib.test.js`
Expected: all 14 tests PASS, 0 failures.

- [ ] **Step 5: Lint and commit**

```bash
cd ~/workspace/nexu
npx biome check skills/nexubot/tabby-image/scripts/lib.js skills/nexubot/tabby-image/scripts/lib.test.js
git add skills/nexubot/tabby-image/scripts/lib.js skills/nexubot/tabby-image/scripts/lib.test.js
git commit -m "feat: add tabby-image skill credential/response parsing library"
```

---

### Task 2: CLI script

**Files:**
- Create: `skills/nexubot/tabby-image/scripts/generate-image.js`

**Interfaces:**
- Consumes (from Task 1): `readOpenclawConfig`, `resolveLinkCredential`, `parseImageResponse`, `resolveOutputPath` from `./lib.js`.
- Produces: an executable script invoked as `node generate-image.js --prompt "..." --filename "out.png" [--size 1024x1024]`. On success, prints `MEDIA: <absolute-path>` as the last stdout line and exits 0. On failure, prints `Error: <message>` to stderr and exits 1.

- [ ] **Step 1: Write the script**

Create `skills/nexubot/tabby-image/scripts/generate-image.js`:

```js
#!/usr/bin/env node

/**
 * Generate an image using the official Tabby Image model (GPT-image-2),
 * served through the user's own Tabby cloud login credential — no
 * separate API key setup required.
 *
 * Usage:
 *   node generate-image.js --prompt "a cat on mars" --filename output.png
 *   node generate-image.js --prompt "a cat on mars" --filename output.png --size 1024x1536
 */

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  readOpenclawConfig,
  resolveLinkCredential,
  parseImageResponse,
  resolveOutputPath,
} from "./lib.js";

const SKILL_NAME = "tabby-image";
const DEFAULT_SIZE = "1024x1024";

function printHelp() {
  console.log(`Usage: node generate-image.js --prompt "desc" --filename "out.png" [options]

Options:
  -p, --prompt      Image description (required)
  -f, --filename    Output filename (required)
      --size        Image size, e.g. 1024x1024 (default), 1024x1536, 1536x1024
  -h, --help        Show this help`);
}

function parseCliArgs() {
  const { values } = parseArgs({
    options: {
      prompt: { type: "string", short: "p" },
      filename: { type: "string", short: "f" },
      size: { type: "string", default: DEFAULT_SIZE },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }
  if (!values.prompt) {
    console.error("Error: --prompt is required");
    process.exit(1);
  }
  if (!values.filename) {
    console.error("Error: --filename is required");
    process.exit(1);
  }

  return { prompt: values.prompt, filename: values.filename, size: values.size };
}

async function downloadImage(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download generated image (${res.status}): ${url}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function main() {
  const args = parseCliArgs();

  let credential;
  try {
    const config = readOpenclawConfig(process.env.OPENCLAW_STATE_DIR);
    credential = resolveLinkCredential(config);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  console.log(`Generating image with model=${credential.model} size=${args.size}...`);

  const res = await fetch(`${credential.baseUrl}/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${credential.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: credential.model,
      prompt: args.prompt,
      n: 1,
      size: args.size,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`Error from tabby-image gateway (${res.status}): ${text}`);
    process.exit(1);
  }

  let image;
  try {
    const body = await res.json();
    image = parseImageResponse(body);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  const imageBytes =
    image.kind === "b64" ? Buffer.from(image.data, "base64") : await downloadImage(image.data);

  const stateDir =
    process.env.OPENCLAW_STATE_DIR ||
    path.join(process.env.HOME || process.env.USERPROFILE || "~", ".openclaw");
  const outputPath = resolveOutputPath({
    stateDir,
    cwd: process.cwd(),
    filename: args.filename,
    skillName: SKILL_NAME,
  });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, imageBytes);

  const stat = fs.statSync(outputPath);
  console.log(`Image saved: ${outputPath} (${Math.round(stat.size / 1024)}KB)`);
  console.log(`MEDIA: ${outputPath}`);
}

await main();
```

- [ ] **Step 2: Run the no-network smoke tests**

These exercise the CLI parsing and credential-resolution failure paths deterministically, without touching the (currently down) gateway:

```bash
cd ~/workspace/nexu/skills/nexubot/tabby-image/scripts

# 1. Help text, should exit 0
node generate-image.js --help
echo "exit=$?"   # expected: 0

# 2. Missing --prompt, should exit 1 with a clear message
node generate-image.js
echo "exit=$?"   # expected: 1, stderr: "Error: --prompt is required"

# 3. Missing --filename, should exit 1 with a clear message
node generate-image.js --prompt "a cat"
echo "exit=$?"   # expected: 1, stderr: "Error: --filename is required"

# 4. No OPENCLAW_STATE_DIR set, should fail credential resolution before any
#    network call — exit 1 with the ENV_MISSING message surfaced as an Error
env -u OPENCLAW_STATE_DIR node generate-image.js --prompt "a cat" --filename cat.png
echo "exit=$?"   # expected: 1, stderr: "Error: ENV_MISSING: OPENCLAW_STATE_DIR is not set..."

# 5. OPENCLAW_STATE_DIR set but no openclaw.json there, should fail with CONFIG_MISSING
OPENCLAW_STATE_DIR=/tmp/tabby-image-smoke-empty node generate-image.js --prompt "a cat" --filename cat.png
echo "exit=$?"   # expected: 1, stderr: "Error: CONFIG_MISSING: ..."
```

Expected: all five invocations behave exactly as annotated above.

- [ ] **Step 3: Lint and commit**

```bash
cd ~/workspace/nexu
npx biome check skills/nexubot/tabby-image/scripts/generate-image.js
git add skills/nexubot/tabby-image/scripts/generate-image.js
git commit -m "feat: add tabby-image generate-image CLI script"
```

---

### Task 3: SKILL.md

**Files:**
- Create: `skills/nexubot/tabby-image/SKILL.md`

**Interfaces:**
- Produces: the skill descriptor OpenClaw reads to decide when to route a request to this skill and how to invoke the script from Task 2.

- [ ] **Step 1: Write the file**

Create `skills/nexubot/tabby-image/SKILL.md`:

````markdown
---
name: tabby-image
catalog-name: Tabby Image (Official)
description: Generate images with the official Tabby Image model (GPT-image-2), included free with your Tabby cloud account login — no API key setup needed. Triggers on "generate image", "tabby image", "official image model", "gpt image".
metadata:
  openclaw:
    emoji: "🖼️"
---

# Tabby Image — Official Image Generation

Generates images using the `tabby-image` model that comes with your logged-in Tabby cloud account. No API key configuration required — this skill reads your existing account credential automatically.

## Generate an image

```bash
node {baseDir}/scripts/generate-image.js --prompt "a cat sitting on mars" --filename "cat-on-mars.png"
```

## Options

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--prompt` | `-p` | required | Image description |
| `--filename` | `-f` | required | Output filename |
| `--size` | — | `1024x1024` | Image size, e.g. `1024x1024`, `1024x1536`, `1536x1024` |

## Account requirements

This skill uses the Tabby cloud credential already configured on this machine — no separate setup. If the script errors with "not logged in", tell the user to log into their official Tabby account in the desktop app (Settings) and try again. If it errors with "does not have access to the tabby-image model", their account tier does not include image generation.

## Output

Relative filenames are saved to `$OPENCLAW_STATE_DIR/media/outbound/{slugid}/tabby-image/{filename}`. Absolute paths are used as-is. Use timestamps in filenames to avoid overwrites: `cat-on-mars-20260304-165000.png`.

## Sending images to the user

The script prints a `MEDIA: <absolute-path>` line on stdout. **You MUST include this exact MEDIA: line in your reply text** so the image is delivered as an attachment in chat.

Example reply:
```
Here's your image!
MEDIA: /Users/alche/.openclaw/media/outbound/my-bot/tabby-image/cat-on-mars.png
```

Rules:
- Copy the `MEDIA:` line from the script output into your reply verbatim — this is how images get sent
- Do NOT read the generated image back with the read tool
- Do NOT try to base64 encode or manually attach the image
- The `MEDIA:` line must be on its own line in your response

## Scope

This skill only generates new images from a text prompt. It does not support editing an existing image or combining multiple images — use a different image skill for those if one is installed.
````

- [ ] **Step 2: Commit**

```bash
cd ~/workspace/nexu
git add skills/nexubot/tabby-image/SKILL.md
git commit -m "docs: add tabby-image SKILL.md"
```

---

### Task 4: Ship the production bundle and register the skill

**Files:**
- Create: `apps/desktop/static/bundled-skills/tabby-image/SKILL.md` (copy of Task 3's file)
- Create: `apps/desktop/static/bundled-skills/tabby-image/scripts/lib.js` (copy of Task 1's file)
- Create: `apps/desktop/static/bundled-skills/tabby-image/scripts/generate-image.js` (copy of Task 2's file)
- Modify: `apps/controller/src/services/skillhub/curated-skills.ts:55-64` (`STATIC_SKILL_SLUGS`)

**Interfaces:**
- Consumes: `STATIC_SKILL_SLUGS: readonly string[]` (existing export), `copyStaticSkills()` (existing function, unmodified — it iterates `STATIC_SKILL_SLUGS` and copies `apps/desktop/static/bundled-skills/{slug}/` into the runtime skills dir).

- [ ] **Step 1: Copy the skill files into the production bundle**

The test-only file (`lib.test.js`) is intentionally NOT copied — the production bundle only ships what runs at skill-execution time.

```bash
cd ~/workspace/nexu
mkdir -p apps/desktop/static/bundled-skills/tabby-image/scripts
cp skills/nexubot/tabby-image/SKILL.md apps/desktop/static/bundled-skills/tabby-image/SKILL.md
cp skills/nexubot/tabby-image/scripts/lib.js apps/desktop/static/bundled-skills/tabby-image/scripts/lib.js
cp skills/nexubot/tabby-image/scripts/generate-image.js apps/desktop/static/bundled-skills/tabby-image/scripts/generate-image.js
```

- [ ] **Step 2: Register the slug**

Open `apps/controller/src/services/skillhub/curated-skills.ts` and change:

```ts
export const STATIC_SKILL_SLUGS: readonly string[] = [
  "libtv-video",
  "coding-agent",
  "gh-issues",
  "clawhub",
  "nano-banana-one-shop",
  "deep-research",
  "research-to-diagram",
  "qiaomu-mondo-poster-design",
] as const;
```

to:

```ts
export const STATIC_SKILL_SLUGS: readonly string[] = [
  "libtv-video",
  "coding-agent",
  "gh-issues",
  "clawhub",
  "nano-banana-one-shop",
  "deep-research",
  "research-to-diagram",
  "qiaomu-mondo-poster-design",
  "tabby-image",
] as const;
```

- [ ] **Step 3: Run the existing skill-bootstrap test to confirm nothing broke**

```bash
cd ~/workspace/nexu
npx vitest run tests/desktop/skill-bootstrap-ordering.test.ts
```

Expected: all tests PASS (this test reads `STATIC_SKILL_SLUGS[0]` dynamically, so appending an entry at the end is safe — see spec §confirmed during design).

- [ ] **Step 4: Typecheck, lint, and verify the bundled copy behaves identically**

```bash
cd ~/workspace/nexu
pnpm --filter @nexu/controller typecheck
npx biome check apps/desktop/static/bundled-skills/tabby-image/

# Sanity: the bundled copy's smoke tests should behave the same as Task 2's
cd apps/desktop/static/bundled-skills/tabby-image/scripts
node generate-image.js --help
echo "exit=$?"   # expected: 0
```

- [ ] **Step 5: Commit**

```bash
cd ~/workspace/nexu
git add apps/desktop/static/bundled-skills/tabby-image apps/controller/src/services/skillhub/curated-skills.ts
git commit -m "feat(desktop): bundle tabby-image skill and register in STATIC_SKILL_SLUGS"
```

---

### Task 5: Manual live-gateway verification (run once tabbyapi.picaso.studio is healthy)

This task cannot be automated in this environment: it depends on the `tabbyapi.picaso.studio` gateway recovering from the 500 outage recorded in the design doc (`specs/design-docs/2026-07-02-tabby-image-skill.md`, §6), and on a real desktop dev environment with a cloud account that has `tabby-image` access. Run this as a manual check before considering the feature done; it is not a blocker for merging Tasks 1–4.

**Files:** none (verification only).

- [ ] **Step 1: Confirm the gateway is healthy**

```bash
curl -s -o /dev/null -w "%{http_code}\n" --max-time 8 https://tabbyapi.picaso.studio/v1/models
```

Expected: `401` (unauthenticated — proves the route itself responds normally, not `500`).

- [ ] **Step 2: Start the local dev stack and log into a cloud account with tabby-image access**

```bash
cd ~/workspace/nexu
pnpm dev start
```

In the desktop app, log into an official Tabby cloud account. Confirm the model synced locally:

```bash
python3 -c "
import json
p = '.tmp/desktop/nexu-home/runtime/openclaw/state/openclaw.json'
with open(p) as f:
    d = json.load(f)
link = d.get('models', {}).get('providers', {}).get('link', {})
print('models:', [m.get('id') for m in link.get('models', [])])
"
```

Expected: `tabby-image` or `tabby-image-free` appears in the printed list. If neither does, this cloud account's tier does not include image generation — try a different account or stop here (the skill's `NO_IMAGE_MODEL` error path is already covered by Task 1's unit tests).

- [ ] **Step 3: Run the script for real**

```bash
OPENCLAW_STATE_DIR=$(pwd)/.tmp/desktop/nexu-home/runtime/openclaw/state \
  node skills/nexubot/tabby-image/scripts/generate-image.js \
  --prompt "a red circle on a white background" \
  --filename "verify-test.png"
```

Expected: prints `Generating image with model=...`, then `Image saved: ...`, then a final `MEDIA: <path>` line. Open the file at that path and confirm it is a valid, non-empty PNG.

- [ ] **Step 4: If `images/edits` is now reachable, note it for a follow-up plan**

```bash
KEY=$(python3 -c "
import json
d = json.load(open('.tmp/desktop/nexu-home/runtime/openclaw/state/openclaw.json'))
print(d['models']['providers']['link']['apiKey'])
")
curl -s -o /dev/null -w "%{http_code}\n" --max-time 15 \
  -X POST "https://tabbyapi.picaso.studio/v1/images/edits" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"tabby-image","prompt":"test"}'
unset KEY
```

If this returns anything other than `404`/`405` (route-not-found), `images/edits` exists — file a short follow-up design note before implementing it (out of scope for this plan per the Global Constraints).

- [ ] **Step 5: Enable the skill on a test bot and verify end-to-end delivery**

In the web UI, install/enable the `tabby-image` skill on a test bot, then send it a message like "generate an image of a red circle on a white background" via any connected channel. Confirm the bot's reply includes the generated image as an attachment (not just the raw `MEDIA:` text).

---

## Self-Review Notes

- **Spec coverage:** §3.1 distribution → Task 4. §3.2 credential resolution → Task 1 (`readOpenclawConfig`, `resolveLinkCredential`). §3.3 API call + response parsing → Task 1 (`parseImageResponse`) + Task 2 (fetch call). §3.4 output delivery → Task 1 (`resolveOutputPath`) + Task 2 (`MEDIA:` line). §3.5 naming/triggers → Task 3. §3.6 parameter scope → Task 2 (`--prompt`, `--filename`, `--size` only). §4 error handling table → Task 1's four error prefixes (`ENV_MISSING`, `CONFIG_MISSING`/`CONFIG_INVALID`, `NOT_LOGGED_IN`, `NO_IMAGE_MODEL`, `BAD_RESPONSE`) plus Task 2's gateway-error passthrough. §5 testing → Task 1 (unit tests) + Task 2 (smoke tests) + Task 5 (manual live test). §6 background is referenced in Global Constraints and Task 5's premise.
- **Placeholder scan:** no TBD/TODO; every code step has complete, runnable code; Task 5 is explicitly marked manual (with exact commands) rather than a vague "verify it works" placeholder, because it depends on third-party gateway state outside this repo's control.
- **Type consistency:** `resolveOutputPath({ stateDir, cwd, filename, skillName })` signature matches between Task 1's definition and Task 2's call site. Error message prefixes (`ENV_MISSING:`, `CONFIG_MISSING:`, `CONFIG_INVALID:`, `NOT_LOGGED_IN:`, `NO_IMAGE_MODEL:`, `BAD_RESPONSE:`) are consistent between Task 1's implementation, its tests, and Task 2's smoke-test expectations.
