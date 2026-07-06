import { access } from "node:fs/promises";
import path from "node:path";
import { logger } from "../lib/logger.js";

/**
 * Prompt-to-image generation for the canvas workbench (design doc
 * 2026-07-03-infinite-canvas-sidebar.md, S7).
 *
 * There is no direct gateway image API — `image_generate` exists only as an
 * agent tool. So this reuses the proven §10.3 execution primitive: one
 * chat.send to a dedicated utility subagent lane instructing the agent to
 * call image_generate and reply with ONLY the generated file path, then the
 * controller polls the session index for completion and hands the file to
 * the existing /api/v1/media/state-file server.
 *
 * W2.5-2.6: extended with reference images, multi-count, video and audio
 * channels (UNAVAILABLE-first — channels ship before backend skills land).
 */

export class ImageGenerationFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageGenerationFailedError";
  }
}

export class InvalidMediaReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMediaReferenceError";
  }
}

export type MediaGenerationServiceDeps = {
  /** Bot that runs the utility lane (any active bot; the default agent). */
  pickUtilityBotId: () => Promise<string | null>;
  sendChat: (input: {
    botId: string;
    sessionKey: string;
    message: string;
  }) => Promise<unknown>;
  readSessionEntry: (
    botId: string,
    sessionKey: string,
  ) => Promise<{ status?: string; sessionFile?: string } | null>;
  readAssistantReply: (sessionFile: string) => Promise<string | null>;
  /** OpenClaw state dir — generated files must live under <stateDir>/media. */
  openclawStateDir: string;
  genId: () => string;
};

export type MediaGenerationServiceOptions = {
  pollIntervalMs?: number;
  /** Skill-driven generation stacks agent overhead (read SKILL.md, spawn the
   * script, poll it) on top of model time — allow several minutes. */
  timeoutMs?: number;
  /** Per-kind timeout overrides. Takes precedence over timeoutMs for image. */
  timeoutMsByKind?: Partial<Record<"image" | "video" | "audio", number>>;
};

type MediaKind = "image" | "video" | "audio";

const IMAGE_PATH_SRC =
  "(\\/[^\\s\"'`]+\\/media\\/[^\\s\"'`]+\\.(?:png|jpe?g|webp|gif))";
const VIDEO_PATH_SRC =
  "(\\/[^\\s\"'`]+\\/media\\/[^\\s\"'`]+\\.(?:mp4|webm|mov|m4v))";
const AUDIO_PATH_SRC =
  "(\\/[^\\s\"'`]+\\/media\\/[^\\s\"'`]+\\.(?:mp3|wav|m4a|ogg|flac))";

function regexForKind(kind: MediaKind): RegExp {
  switch (kind) {
    case "image":
      return new RegExp(IMAGE_PATH_SRC, "gi");
    case "video":
      return new RegExp(VIDEO_PATH_SRC, "gi");
    case "audio":
      return new RegExp(AUDIO_PATH_SRC, "gi");
  }
}

/** Extract all plausible media-file paths from the agent's reply for a given kind. */
export function extractMediaPaths(reply: string, kind: MediaKind): string[] {
  const re = regexForKind(kind);
  const results: string[] = [];
  for (const match of reply.matchAll(re)) {
    if (match[1] !== undefined) {
      results.push(match[1]);
    }
  }
  return results;
}

/** Extract the first plausible image media-file path from the agent's reply. */
export function extractMediaPath(reply: string): string | null {
  return extractMediaPaths(reply, "image")[0] ?? null;
}

export type GeneratedMediaItem = { url: string; path: string };
export type GenerateMediaResult = {
  url: string;
  path: string;
  items: GeneratedMediaItem[];
};

export class MediaGenerationService {
  private readonly pollIntervalMs: number;
  private readonly timeoutMsByKind: Record<MediaKind, number>;

  constructor(
    private readonly deps: MediaGenerationServiceDeps,
    options: MediaGenerationServiceOptions = {},
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? 2_000;
    const base = options.timeoutMs ?? 240_000;
    this.timeoutMsByKind = {
      image: options.timeoutMsByKind?.image ?? base,
      video: options.timeoutMsByKind?.video ?? 480_000,
      audio: options.timeoutMsByKind?.audio ?? 240_000,
    };
    // Back-compat: if timeoutMs was set, let it override image unless kind-specific set.
    if (
      options.timeoutMs !== undefined &&
      options.timeoutMsByKind?.image === undefined
    ) {
      this.timeoutMsByKind.image = options.timeoutMs;
    }
  }

  async generateImage(input: {
    prompt: string;
    referenceImages?: string[];
    count?: number;
  }): Promise<GenerateMediaResult> {
    const mediaRoot = path.resolve(this.deps.openclawStateDir, "media");

    // Validate reference images BEFORE sending anything.
    if (input.referenceImages && input.referenceImages.length > 0) {
      for (const ref of input.referenceImages) {
        await this.validateMediaReference(ref, mediaRoot);
      }
    }

    const botId = await this.deps.pickUtilityBotId();
    if (!botId) {
      throw new ImageGenerationFailedError(
        "no active bot available to run image generation",
      );
    }

    const count = input.count ?? 1;
    const sessionKey = `agent:${botId}:subagent:imagegen-${this.deps.genId()}`;

    const lines: string[] = [
      count === 1
        ? "[TASK] Generate one image."
        : `[TASK] Generate ${count} images.`,
      `Prompt: ${input.prompt}`,
    ];

    if (input.referenceImages && input.referenceImages.length > 0) {
      lines.push(
        "",
        "Reference images (guide the generation with them if your tool or skill supports image references; if not, ignore this block):",
        ...input.referenceImages,
      );
    }

    lines.push(
      "",
      "Rules (in order):",
      count === 1
        ? "1. If the image_generate tool is in your toolset, call it exactly"
        : `1. If the image_generate tool is in your toolset, call it exactly ${count} times (or once with count ${count} if the tool supports it)`,
      "   once with this prompt.",
      "2. Otherwise use the official tabby-image skill (its script prints a",
      "   MEDIA: <absolute-path> line; the file lands under the media dir).",
      '3. If neither works, reply with ONLY the word "UNAVAILABLE" — no',
      "   other workarounds.",
    );

    if (count === 1) {
      lines.push(
        "- Reply with ONLY the generated file's absolute path — one line, no",
        "  other words, no markdown, and do NOT render UI (no render_a2ui).",
      );
    } else {
      lines.push(
        `- Reply with ALL ${count} generated files' absolute paths, one per line,`,
        "  no other words, no markdown, and do NOT render UI (no render_a2ui).",
      );
    }

    const message = lines.join("\n");
    await this.deps.sendChat({ botId, sessionKey, message });

    const reply = await this.awaitLaneReply(botId, sessionKey, "image");

    if (/\bUNAVAILABLE\b/.test(reply)) {
      throw new ImageGenerationFailedError(
        "image generation backend is not configured (image_generate tool unavailable)",
      );
    }

    return this.validateAndBuildResult(
      reply,
      "image",
      mediaRoot,
      count,
      "image",
    );
  }

  async generateVideo(input: {
    prompt: string;
    durationSeconds?: number;
    resolution?: "720p" | "1080p";
  }): Promise<GenerateMediaResult> {
    const botId = await this.deps.pickUtilityBotId();
    if (!botId) {
      throw new ImageGenerationFailedError(
        "no active bot available to run video generation",
      );
    }

    const sessionKey = `agent:${botId}:subagent:videogen-${this.deps.genId()}`;
    const hints: string[] = [];
    if (input.durationSeconds !== undefined) {
      hints.push(`Duration: ${input.durationSeconds} seconds`);
    }
    if (input.resolution !== undefined) {
      hints.push(`Resolution: ${input.resolution}`);
    }

    const lines: string[] = [
      "[TASK] Generate a video clip.",
      `Prompt: ${input.prompt}`,
      ...(hints.length > 0 ? ["", ...hints] : []),
      "",
      "Rules (in order):",
      "1. If a video-generation tool (e.g. video_generate) is in your toolset,",
      "   call it once with this prompt (include duration/resolution hints when",
      "   provided).",
      "2. Otherwise if an official video-generation skill is installed (its",
      "   script writes files under the media dir and prints their paths) use it.",
      '3. Otherwise reply ONLY the word "UNAVAILABLE" — no other workarounds.',
      "- Reply with ONLY the generated file's absolute path (or paths, one per",
      "  line) — no other words, no markdown, and do NOT render UI.",
    ];

    const message = lines.join("\n");
    await this.deps.sendChat({ botId, sessionKey, message });

    const mediaRoot = path.resolve(this.deps.openclawStateDir, "media");
    const reply = await this.awaitLaneReply(botId, sessionKey, "video");

    if (/\bUNAVAILABLE\b/.test(reply)) {
      throw new ImageGenerationFailedError(
        "video generation backend is not configured",
      );
    }

    return this.validateAndBuildResult(
      reply,
      "video",
      mediaRoot,
      undefined,
      "video",
    );
  }

  async generateAudio(input: {
    prompt: string;
    voice?: string;
    speed?: number;
  }): Promise<GenerateMediaResult> {
    const botId = await this.deps.pickUtilityBotId();
    if (!botId) {
      throw new ImageGenerationFailedError(
        "no active bot available to run audio generation",
      );
    }

    const sessionKey = `agent:${botId}:subagent:audiogen-${this.deps.genId()}`;
    const hints: string[] = [];
    if (input.voice !== undefined) {
      hints.push(`Voice: ${input.voice}`);
    }
    if (input.speed !== undefined) {
      hints.push(`Speed: ${input.speed}`);
    }

    const lines: string[] = [
      "[TASK] Generate an audio file.",
      `Prompt: ${input.prompt}`,
      ...(hints.length > 0 ? ["", ...hints] : []),
      "",
      "Rules (in order):",
      "1. If an audio-generation tool (e.g. audio_generate) is in your toolset,",
      "   call it once with this prompt (include voice/speed hints when provided).",
      "2. Otherwise if an official TTS or audio-generation skill is installed",
      "   (its script writes files under the media dir and prints their paths)",
      "   use it.",
      '3. Otherwise reply ONLY the word "UNAVAILABLE" — no other workarounds.',
      "- Reply with ONLY the generated file's absolute path (or paths, one per",
      "  line) — no other words, no markdown, and do NOT render UI.",
    ];

    const message = lines.join("\n");
    await this.deps.sendChat({ botId, sessionKey, message });

    const mediaRoot = path.resolve(this.deps.openclawStateDir, "media");
    const reply = await this.awaitLaneReply(botId, sessionKey, "audio");

    if (/\bUNAVAILABLE\b/.test(reply)) {
      throw new ImageGenerationFailedError(
        "audio generation backend is not configured",
      );
    }

    return this.validateAndBuildResult(
      reply,
      "audio",
      mediaRoot,
      undefined,
      "audio",
    );
  }

  private async validateMediaReference(
    ref: string,
    mediaRoot: string,
  ): Promise<void> {
    const resolved = path.resolve(ref);
    const relative = path.relative(mediaRoot, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new InvalidMediaReferenceError(
        `reference image is outside the media directory: ${ref}`,
      );
    }
    try {
      await access(resolved);
    } catch {
      throw new InvalidMediaReferenceError(
        `reference image does not exist: ${ref}`,
      );
    }
  }

  private async validateAndBuildResult(
    reply: string,
    kind: MediaKind,
    mediaRoot: string,
    count: number | undefined,
    logLabel: string,
  ): Promise<GenerateMediaResult> {
    const candidates = extractMediaPaths(reply, kind);
    const capped =
      count !== undefined ? candidates.slice(0, count) : candidates;

    const validItems: GeneratedMediaItem[] = [];
    for (const candidate of capped) {
      const resolved = path.resolve(candidate);
      const relative = path.relative(mediaRoot, resolved);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        // Skip paths outside media dir (don't throw — ≥1 valid path rule).
        continue;
      }
      try {
        await access(resolved);
        validItems.push({
          path: resolved,
          url: `/api/v1/media/state-file?path=${encodeURIComponent(resolved)}`,
        });
      } catch {
        // File doesn't exist; skip.
      }
    }

    if (validItems.length === 0) {
      if (candidates.length === 0) {
        throw new ImageGenerationFailedError(
          "generation finished but no media path was found in the reply",
        );
      }
      throw new ImageGenerationFailedError(
        "generated path is outside the media directory",
      );
    }

    // validItems.length > 0 is guaranteed by the check above.
    const first = validItems[0] as GeneratedMediaItem;
    logger.info(
      { kind: logLabel, count: validItems.length, path: first.path },
      "media generation: ready",
    );

    return {
      path: first.path,
      url: first.url,
      items: validItems,
    };
  }

  private async awaitLaneReply(
    botId: string,
    sessionKey: string,
    kind: MediaKind,
  ): Promise<string> {
    const timeoutMs = this.timeoutMsByKind[kind];
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const entry = await this.deps.readSessionEntry(botId, sessionKey);
      if (entry?.status === "done") {
        const reply = entry.sessionFile
          ? await this.deps.readAssistantReply(entry.sessionFile)
          : null;
        if (reply?.trim()) {
          return reply.trim();
        }
        // A turn can end on a bare tool call; the lane may still run a
        // queued follow-up turn — keep polling until the deadline.
      }
      if (entry?.status === "failed") {
        throw new ImageGenerationFailedError("generation session failed");
      }
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }
    throw new ImageGenerationFailedError(
      `generation timed out after ${timeoutMs}ms`,
    );
  }
}
