/**
 * generate-prompt-snapshot.ts — refresh the bundled prompt-library snapshot.
 *
 * Fetches + parses all five GitHub prompt collections through the SAME
 * loaders the app uses at runtime (prompt-library-data.loadAllSources) and
 * writes a capped subset to src/lib/canvas/prompt-library-snapshot.json.
 * The snapshot is the built-in baseline the dialog shows instantly / offline;
 * live data replaces it via the background refresh.
 *
 * Run from repo root:
 *   pnpm --filter @nexu/web generate:prompt-snapshot
 *
 * The snapshot carries the FULL text dataset (~1 MB) — covers stay remote
 * URLs (served via the controller cover cache at runtime).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type LibraryPrompt,
  loadAllSources,
} from "../src/lib/canvas/prompt-library-data";

const PER_CATEGORY_CAP = Number.POSITIVE_INFINITY;

const outPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../src/lib/canvas/prompt-library-snapshot.json",
);

const items = await loadAllSources();
if (items.length === 0) {
  console.error(
    "No prompts fetched — network to raw.githubusercontent.com failed. Snapshot NOT updated.",
  );
  process.exit(1);
}

const byCategory = new Map<string, LibraryPrompt[]>();
for (const item of items) {
  const bucket = byCategory.get(item.category) ?? [];
  if (bucket.length < PER_CATEGORY_CAP) bucket.push(item);
  byCategory.set(item.category, bucket);
}
const snapshot = [...byCategory.values()].flat();

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(snapshot, null, 2)}\n`);

const kb = Math.round(JSON.stringify(snapshot).length / 1024);
console.log(
  `Snapshot written: ${snapshot.length} prompts across ${byCategory.size} categories (${kb} KB) → ${outPath}`,
);
