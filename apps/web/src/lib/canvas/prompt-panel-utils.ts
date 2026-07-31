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

import type { VideoAspectRatio } from "./video-generation-params";

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
    if (parsed.pathname !== "/api/v1/media/state-file") return null;
    const path = parsed.searchParams.get("path");
    return path ?? null;
  } catch {
    return null;
  }
}

// ── servableSourceOf ───────────────────────────────────────────

/**
 * Return the absolute server path for an image node whose content is a servable
 * state-file URL, or `null` for everything else.
 *
 * All four T6 features (mask, angle, AI upscale, reverse-prompt) gate on this:
 * dataURL uploads can't be server-edited.
 */
export function servableSourceOf(
  node: Pick<
    { type: string; metadata: { content?: string } },
    "type" | "metadata"
  >,
): string | null {
  if (node.type !== "image") return null;
  const content = node.metadata.content;
  if (!content) return null;
  return servablePathFromUrl(content);
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

/**
 * Merge the panel's own typed prompt with connected upstream text-node
 * content, matching config-node-logic.ts's buildConfigGenerationPlan
 * pattern exactly: local prompt first, then each non-empty trimmed upstream
 * prompt, joined with a blank line. Without this, the "文本 N" upstream
 * summary badge implies a connected text node feeds generation when it
 * previously didn't — see resource-references.ts's own docstring ("an edge
 * INTO a node means this feeds your generation").
 */
export function mergeUpstreamPrompt(
  localPrompt: string,
  upstreamPrompts: ReadonlyArray<string>,
): string {
  return [localPrompt.trim(), ...upstreamPrompts.map((p) => p.trim())]
    .filter((p) => p.length > 0)
    .join("\n\n");
}

// ── generation option builders (W5) ────────────────────────────
//
// Map the panel's per-mode settings state into the `generate*IntoNode` opts.
// All new params are best-effort HINTS: a control left at its default (auto /
// 默认 / empty / count 1 / speed 1 / unchecked) is OMITTED so the backend
// picks its own default rather than being pinned. Pure + unit-testable — the
// no-DOM test env can't fire the generate button, so this is the seam the
// forward tests exercise.

export type ImageQuality = "auto" | "high" | "medium" | "low";
export type AudioFormat = "mp3" | "wav" | "m4a" | "ogg" | "flac";

export type ImageGenSettings = {
  /** Absolute upstream reference paths (already resolved), or undefined. */
  referenceImages?: string[];
  /** 1..12; 1 = omit. */
  count: number;
  /** Model id hint; "" = default model = omit. */
  model: string;
  /** "auto" = omit. */
  quality: ImageQuality;
  /** e.g. "1:1"; "" = omit. */
  aspectRatio: string;
  /** "1K" | "2K" | "4K"; "" = omit. */
  size: string;
  /** false (default) = omit. */
  transparentBackground?: boolean;
};

export type ImageGenOpts = {
  referenceImages?: string[];
  count?: number;
  model?: string;
  quality?: ImageQuality;
  aspectRatio?: string;
  size?: string;
  transparentBackground?: boolean;
};

export function buildImageGenOpts(s: ImageGenSettings): ImageGenOpts {
  return {
    ...(s.referenceImages && s.referenceImages.length > 0
      ? { referenceImages: s.referenceImages }
      : {}),
    ...(s.count > 1 ? { count: s.count } : {}),
    ...(s.model !== "" ? { model: s.model } : {}),
    ...(s.quality !== "auto" ? { quality: s.quality } : {}),
    ...(s.aspectRatio !== "" ? { aspectRatio: s.aspectRatio } : {}),
    ...(s.size !== "" ? { size: s.size } : {}),
    ...(s.transparentBackground === true
      ? { transparentBackground: true }
      : {}),
  };
}

export type VideoGenSettings = {
  resolution: "480p" | "720p" | "1080p";
  /** e.g. "16:9"; "" = omit. */
  aspectRatio: VideoAspectRatio | "";
  numFrames: number;
  frameRate: number;
  numInferenceSteps: string;
  negativePrompt: string;
  seed: string;
  /** Model id hint; "" = omit. */
  model: string;
};

export type VideoGenOpts = {
  resolution?: "480p" | "720p" | "1080p";
  model?: string;
  aspectRatio?: VideoAspectRatio;
  numFrames?: number;
  frameRate?: number;
  numInferenceSteps?: number;
  negativePrompt?: string;
  seed?: number;
};

export function buildVideoGenOpts(s: VideoGenSettings): VideoGenOpts {
  const negativePrompt = s.negativePrompt.trim();
  const seedInput = s.seed.trim();
  const seed = Number(seedInput);
  const inferenceStepsInput = s.numInferenceSteps.trim();
  const numInferenceSteps = Number(inferenceStepsInput);
  return {
    resolution: s.resolution,
    numFrames: s.numFrames,
    frameRate: s.frameRate,
    ...(inferenceStepsInput !== "" &&
    Number.isSafeInteger(numInferenceSteps) &&
    numInferenceSteps > 0
      ? { numInferenceSteps }
      : {}),
    ...(s.model !== "" ? { model: s.model } : {}),
    ...(s.aspectRatio !== "" ? { aspectRatio: s.aspectRatio } : {}),
    ...(negativePrompt !== "" ? { negativePrompt } : {}),
    ...(seedInput !== "" && Number.isSafeInteger(seed) ? { seed } : {}),
  };
}

export type AudioGenSettings = {
  /** Voice identifier; "" (after trim) = omit. */
  voice: string;
  /** 1 = omit. */
  speed: number;
  /** Model id hint; "" = omit. */
  model: string;
  /** "" = default = omit. */
  format: AudioFormat | "";
  /** Extra voice direction; "" (after trim) = omit. */
  instructions: string;
};

export type AudioGenOpts = {
  voice?: string;
  speed?: number;
  model?: string;
  format?: AudioFormat;
  instructions?: string;
};

export function buildAudioGenOpts(s: AudioGenSettings): AudioGenOpts {
  const voice = s.voice.trim();
  const instructions = s.instructions.trim();
  return {
    ...(voice !== "" ? { voice } : {}),
    ...(s.speed !== 1 ? { speed: s.speed } : {}),
    ...(s.model !== "" ? { model: s.model } : {}),
    ...(s.format !== "" ? { format: s.format } : {}),
    ...(instructions !== "" ? { instructions } : {}),
  };
}

/** Chinese display label for an image quality value (settings chip/popover). */
export function imageQualityLabel(quality: ImageQuality): string {
  switch (quality) {
    case "auto":
      return "自动";
    case "high":
      return "高";
    case "medium":
      return "中";
    case "low":
      return "低";
  }
}

/**
 * One-line summary for the image settings chip, e.g. "自动 · 1:1 · 3 张".
 * Aspect/size fall back to 默认 when unset; size is appended only when set
 * so the chip stays compact in the common case.
 */
export function imageSettingsSummary(s: {
  quality: ImageQuality;
  aspectRatio: string;
  size: string;
  count: number;
}): string {
  const parts = [imageQualityLabel(s.quality), s.aspectRatio || "默认"];
  if (s.size !== "") parts.push(s.size);
  parts.push(`${s.count} 张`);
  return parts.join(" · ");
}

/**
 * One-line summary for the video settings chip, e.g. "121帧 · 5s · 720p · 16:9".
 */
export function videoSettingsSummary(s: {
  numFrames: number;
  frameRate: number;
  resolution: string;
  aspectRatio: string;
}): string {
  const seconds =
    s.frameRate > 0 ? Math.round((s.numFrames / s.frameRate) * 10) / 10 : 0;
  return [
    `${s.numFrames}帧`,
    `${seconds}s`,
    s.resolution,
    s.aspectRatio || "默认",
  ].join(" · ");
}

/** One-line summary for the audio settings chip, e.g. "默认音色 · 1x · mp3". */
export function audioSettingsSummary(s: {
  voice: string;
  speed: number;
  format: string;
}): string {
  const parts = [s.voice.trim() || "默认音色", `${s.speed}x`];
  if (s.format !== "") parts.push(s.format);
  return parts.join(" · ");
}
