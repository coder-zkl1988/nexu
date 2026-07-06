import { access, mkdir, writeFile } from "node:fs/promises";
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
  timeoutMsByKind?: Partial<
    Record<"image" | "video" | "audio" | "enhance", number>
  >;
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

export type EnhanceMediaResult = {
  url: string;
  path: string;
  items: GeneratedMediaItem[];
};

export type DescribeMediaResult = { prompt: string };

export class MediaGenerationService {
  private readonly pollIntervalMs: number;
  private readonly timeoutMsByKind: Record<MediaKind | "enhance", number>;

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
      enhance: options.timeoutMsByKind?.enhance ?? 480_000,
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
    sourceImage?: string;
    maskDataUrl?: string;
  }): Promise<GenerateMediaResult> {
    const mediaRoot = path.resolve(this.deps.openclawStateDir, "media");

    // Validate reference images BEFORE sending anything.
    if (input.referenceImages && input.referenceImages.length > 0) {
      for (const ref of input.referenceImages) {
        await this.validateMediaReference(ref, mediaRoot);
      }
    }

    // Validate sourceImage (inpaint/img2img source).
    if (input.sourceImage !== undefined) {
      await this.validateMediaReference(input.sourceImage, mediaRoot);
    }

    // Decode and write mask file BEFORE sendChat.
    let maskPath: string | undefined;
    if (input.maskDataUrl !== undefined && input.sourceImage !== undefined) {
      maskPath = await this.writeMaskFile(input.maskDataUrl);
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

    // Source image block (inpaint / img2img).
    if (input.sourceImage !== undefined) {
      if (maskPath !== undefined) {
        lines.push(
          "",
          `Edit the source image ${input.sourceImage} ONLY inside the masked region (mask file ${maskPath}, white = editable, black = keep). Requested change: ${input.prompt}.`,
        );
      } else {
        lines.push(
          "",
          `Source image (edit/transform it rather than generating from scratch): ${input.sourceImage}`,
        );
      }
    }

    lines.push(
      "",
      "Rules (in order):",
      count === 1
        ? "1. If the image_generate tool is in your toolset, call it exactly"
        : `1. If the image_generate tool is in your toolset, call it exactly ${count} times (or once with count ${count} if the tool supports it)`,
    );
    if (count === 1) {
      lines.push("   once with this prompt.");
    }
    lines.push(
      "2. Otherwise use the official tabby-image skill (its script prints a",
      "   MEDIA: <absolute-path> line; the file lands under the media dir).",
      maskPath !== undefined
        ? "3. If no available tool or skill can edit images (with masks when given), reply ONLY UNAVAILABLE."
        : '3. If neither works, reply with ONLY the word "UNAVAILABLE" — no',
    );
    if (maskPath === undefined) {
      lines.push("   other workarounds.");
    }

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

  async enhanceImage(input: {
    sourceImage: string;
    operation: "super-resolve" | "multi-angle";
    targetLongEdge?: 1024 | 2048 | 4096;
    horizontalDeg?: number;
    pitchDeg?: number;
    distance?: number;
    wideAngle?: boolean;
    prompt?: string;
  }): Promise<EnhanceMediaResult> {
    const mediaRoot = path.resolve(this.deps.openclawStateDir, "media");
    await this.validateMediaReference(input.sourceImage, mediaRoot);

    const botId = await this.deps.pickUtilityBotId();
    if (!botId) {
      throw new ImageGenerationFailedError(
        "no active bot available to run image enhancement",
      );
    }

    const sessionKey = `agent:${botId}:subagent:imgenhance-${this.deps.genId()}`;

    const lines: string[] = [];
    if (input.operation === "super-resolve") {
      const longEdge = input.targetLongEdge ?? 2048;
      lines.push(
        `Upscale/enhance the image at ${input.sourceImage} to a long edge of ${longEdge} px using a super-resolution tool or skill`,
      );
    } else {
      const h = input.horizontalDeg ?? 0;
      const p = input.pitchDeg ?? 0;
      const d = input.distance ?? 5;
      const wideStr = input.wideAngle ? ", wide-angle lens" : "";
      lines.push(
        `Re-render the image at ${input.sourceImage} from a different camera angle: horizontal ${h}°, pitch ${p}°, distance ${d}/10${wideStr}`,
      );
    }

    lines.push(
      "",
      "Reply with ONLY the output file's absolute path (under the media dir), one line, no markdown, and do NOT render UI.",
      'If no available tool or skill can perform this operation, reply ONLY the word "UNAVAILABLE".',
    );

    if (input.prompt) {
      lines.push("", `Extra guidance: ${input.prompt}`);
    }

    const message = lines.join("\n");
    await this.deps.sendChat({ botId, sessionKey, message });

    // Enhance can be slow; use the video timeout (480_000 default) as it is
    // sized for long-running generation-class tasks.
    const enhanceTimeoutMs = this.timeoutMsByKind.enhance;
    const reply = await this.awaitLaneReplyWithTimeout(
      botId,
      sessionKey,
      enhanceTimeoutMs,
    );

    if (/\bUNAVAILABLE\b/.test(reply)) {
      throw new ImageGenerationFailedError(
        "image enhancement backend is not configured",
      );
    }

    return this.validateAndBuildResult(
      reply,
      "image",
      mediaRoot,
      undefined,
      "imgenhance",
    );
  }

  async describeImage(input: {
    sourceImage: string;
  }): Promise<DescribeMediaResult> {
    const mediaRoot = path.resolve(this.deps.openclawStateDir, "media");
    await this.validateMediaReference(input.sourceImage, mediaRoot);

    const botId = await this.deps.pickUtilityBotId();
    if (!botId) {
      throw new ImageGenerationFailedError(
        "no active bot available to run image description",
      );
    }

    const sessionKey = `agent:${botId}:subagent:imgdescribe-${this.deps.genId()}`;

    const message = [
      `Look at the image file at ${input.sourceImage}. Reply with ONLY a text-to-image generation prompt (one paragraph) that would recreate this image — no preamble, no quotes. If you cannot view or analyze images, reply ONLY UNAVAILABLE.`,
    ].join("\n");

    await this.deps.sendChat({ botId, sessionKey, message });

    // Use min(configured image timeout, 120_000) for describe.
    const describeTimeoutMs = Math.min(this.timeoutMsByKind.image, 120_000);
    const reply = await this.awaitLaneReplyWithTimeout(
      botId,
      sessionKey,
      describeTimeoutMs,
      true,
    );

    if (/\bUNAVAILABLE\b/.test(reply)) {
      throw new ImageGenerationFailedError(
        "image description backend is not configured",
      );
    }

    const trimmed = reply.trim().slice(0, 2_000);
    if (!trimmed) {
      throw new ImageGenerationFailedError(
        "image description finished but returned an empty prompt",
      );
    }

    logger.info(
      { path: input.sourceImage },
      "media generation: describe ready",
    );
    return { prompt: trimmed };
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

  /** Decode maskDataUrl, write to media/inbound/mask-<genId>.png, return path. */
  private async writeMaskFile(maskDataUrl: string): Promise<string> {
    // Strip the data URL prefix: data:image/png;base64,<payload>
    const commaIdx = maskDataUrl.indexOf(",");
    if (commaIdx === -1) {
      throw new InvalidMediaReferenceError("invalid mask data");
    }
    const b64 = maskDataUrl.slice(commaIdx + 1);
    let buf: Buffer;
    try {
      buf = Buffer.from(b64, "base64");
      // Validate: a valid base64 round-trip should not produce an empty buffer
      // and re-encoding should match the input (modulo padding).
      if (buf.length === 0) {
        throw new InvalidMediaReferenceError("invalid mask data");
      }
      // Strict check: base64 decode then re-encode must reproduce input (ignoring whitespace).
      const re = buf.toString("base64");
      const normalised = b64.replace(/\s/g, "");
      // Allow padding differences only
      if (re.replace(/=+$/, "") !== normalised.replace(/=+$/, "")) {
        throw new InvalidMediaReferenceError("invalid mask data");
      }
    } catch (err) {
      if (err instanceof InvalidMediaReferenceError) {
        throw err;
      }
      throw new InvalidMediaReferenceError("invalid mask data");
    }
    const inboundDir = path.resolve(
      this.deps.openclawStateDir,
      "media",
      "inbound",
    );
    await mkdir(inboundDir, { recursive: true });
    const maskPath = path.join(inboundDir, `mask-${this.deps.genId()}.png`);
    await writeFile(maskPath, buf);
    return maskPath;
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
    const seenPaths = new Set<string>();
    for (const candidate of capped) {
      const resolved = path.resolve(candidate);
      const relative = path.relative(mediaRoot, resolved);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        // Skip paths outside media dir (don't throw — ≥1 valid path rule).
        continue;
      }
      if (seenPaths.has(resolved)) {
        // Skip duplicate path.
        continue;
      }
      try {
        await access(resolved);
        seenPaths.add(resolved);
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
    return this.awaitLaneReplyWithTimeout(
      botId,
      sessionKey,
      this.timeoutMsByKind[kind],
    );
  }

  private async awaitLaneReplyWithTimeout(
    botId: string,
    sessionKey: string,
    timeoutMs: number,
    /** When true, return the reply even if empty (caller checks for empty). */
    allowEmptyReply = false,
  ): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const entry = await this.deps.readSessionEntry(botId, sessionKey);
      if (entry?.status === "done") {
        const reply = entry.sessionFile
          ? await this.deps.readAssistantReply(entry.sessionFile)
          : null;
        if (allowEmptyReply) {
          // Return whatever the agent replied (including empty/whitespace).
          return reply ?? "";
        }
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
