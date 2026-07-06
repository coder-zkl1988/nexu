/**
 * prompt-panel-utils.ts
 *
 * Pure helpers for the per-node prompt panel (W2.4).
 * No side effects, no imports from the store — fully unit-testable.
 *
 * Reference feeding contract:
 * - @-mentions in the prompt textarea are PLAIN TEXT only (for display and
 *   human context). Actual image references auto-attach via usableReferencePaths
 *   based on the upstream graph — the backend receives absolute paths, not
 *   dataURLs or mention tokens.
 */

// ── servablePathFromUrl ────────────────────────────────────────

/**
 * Extract the decoded `path` query param from a state-file URL of the form
 * `/api/v1/media/state-file?path=<encoded-abs-path>`.
 *
 * Accepts both relative paths (/api/v1/...) and absolute-origin URLs
 * (http://localhost/.../state-file?path=...).
 *
 * Returns `null` for:
 *  - dataURLs (data:...)
 *  - arbitrary external URLs not matching the state-file endpoint
 *  - empty / unparseable inputs
 */
export function servablePathFromUrl(url: string): string | null {
  if (!url || url.startsWith("data:")) return null;

  try {
    // For relative URLs, use a dummy base so URL() can parse them.
    const parsed = new URL(url, "http://localhost");
    if (!parsed.pathname.endsWith("/api/v1/media/state-file")) return null;
    const path = parsed.searchParams.get("path");
    return path ?? null;
  } catch {
    return null;
  }
}

// ── usableReferencePaths ───────────────────────────────────────

/**
 * From a list of image content values (dataURLs or servable URLs), return
 * the absolute paths accepted by the backend as `referenceImages`.
 *
 * - Drops dataURLs (the backend cannot use them).
 * - Maps valid state-file URLs to their decoded path param.
 * - Caps the result at 4 items (backend limit).
 */
export function usableReferencePaths(images: ReadonlyArray<string>): string[] {
  const paths: string[] = [];
  for (const img of images) {
    if (paths.length >= 4) break;
    const path = servablePathFromUrl(img);
    if (path !== null) paths.push(path);
  }
  return paths;
}

// ── mentionQueryAt ─────────────────────────────────────────────

type MentionToken = { query: string; start: number };

/**
 * Detect an active @-mention token at `caret` in `text`.
 *
 * Rules:
 *  - An active token starts with `@` that is either at position 0 OR preceded
 *    by a whitespace character.
 *  - Between the `@` and the caret there must be no whitespace.
 *  - The `query` is the text between `@` (exclusive) and `caret`.
 *  - If multiple `@` satisfy the conditions, the LAST one wins.
 *  - Returns `null` if no active token is found.
 */
export function mentionQueryAt(
  text: string,
  caret: number,
): MentionToken | null {
  // Search backward from caret for the last valid @ starter.
  // We scan the substring [0, caret) looking for the rightmost @
  // that (a) is at index 0 or preceded by whitespace, and (b) has no
  // whitespace between it and caret.
  const slice = text.slice(0, caret);

  // Walk backward: find the last @ that is a valid mention start.
  let atIndex = -1;
  for (let i = slice.length - 1; i >= 0; i--) {
    const ch = slice[i];
    if (ch === "@") {
      // Valid start: position 0 or preceded by whitespace
      const prev: string | null = i > 0 ? (slice[i - 1] ?? null) : null;
      if (prev === null || /\s/.test(prev)) {
        atIndex = i;
        break;
      }
    } else if (ch !== undefined && /\s/.test(ch)) {
      // Hit whitespace before finding a valid @: no active mention
      break;
    }
  }

  if (atIndex === -1) return null;

  // The query is everything from after the @ to the caret.
  const query = slice.slice(atIndex + 1);

  // If the query itself contains whitespace, the mention is not active.
  if (/\s/.test(query)) return null;

  return { query, start: atIndex };
}

// ── upstreamSummary ────────────────────────────────────────────

type UpstreamResources = {
  prompts: string[];
  images: string[];
  videos: string[];
  audios: string[];
};

/**
 * Build a one-line Chinese summary of upstream resources for display in the
 * prompt panel header.
 *
 * Format examples:
 *  - `文本 2 · 参考图 3 · 视频 1 · 音频 2`
 *  - `参考图 3（可用 2）` — usable count shown only when different from total
 *  - `无上游输入` — when all buckets are empty
 *
 * Groups with zero items are omitted.
 */
export function upstreamSummary(
  r: UpstreamResources,
  usableImages: number,
): string {
  const parts: string[] = [];

  if (r.prompts.length > 0) {
    parts.push(`文本 ${r.prompts.length}`);
  }

  if (r.images.length > 0) {
    const imageLabel =
      usableImages !== r.images.length
        ? `参考图 ${r.images.length}（可用 ${usableImages}）`
        : `参考图 ${r.images.length}`;
    parts.push(imageLabel);
  }

  if (r.videos.length > 0) {
    parts.push(`视频 ${r.videos.length}`);
  }

  if (r.audios.length > 0) {
    parts.push(`音频 ${r.audios.length}`);
  }

  return parts.length === 0 ? "无上游输入" : parts.join(" · ");
}
