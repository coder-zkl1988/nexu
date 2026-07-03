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
 */

export class ImageGenerationFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageGenerationFailedError";
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
  /** Image models are slow — allow a few minutes end to end. */
  timeoutMs?: number;
};

const MEDIA_PATH_RE =
  /(\/[^\s"'`]+\/media\/[^\s"'`]+\.(?:png|jpe?g|webp|gif))/i;

/** Extract the first plausible media-file path from the agent's reply. */
export function extractMediaPath(reply: string): string | null {
  const match = reply.match(MEDIA_PATH_RE);
  return match?.[1] ?? null;
}

export class MediaGenerationService {
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;

  constructor(
    private readonly deps: MediaGenerationServiceDeps,
    options: MediaGenerationServiceOptions = {},
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? 2_000;
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  async generateImage(input: { prompt: string }): Promise<{
    path: string;
    url: string;
  }> {
    const botId = await this.deps.pickUtilityBotId();
    if (!botId) {
      throw new ImageGenerationFailedError(
        "no active bot available to run image generation",
      );
    }
    const sessionKey = `agent:${botId}:subagent:imagegen-${this.deps.genId()}`;
    const message = [
      "[TASK] Generate one image with the image_generate tool.",
      `Prompt: ${input.prompt}`,
      "",
      "Rules:",
      "- Call the image_generate tool exactly once with this prompt.",
      "- If the image_generate tool is NOT in your toolset (or no image",
      '  backend is configured), reply with ONLY the word "UNAVAILABLE" —',
      "  do NOT try skills, shell commands, or any other workaround.",
      "- The tool writes the file into the media directory.",
      "- Reply with ONLY the generated file's absolute path — one line, no",
      "  other words, no markdown, and do NOT render UI (no render_a2ui).",
    ].join("\n");

    await this.deps.sendChat({ botId, sessionKey, message });

    const reply = await this.awaitLaneReply(botId, sessionKey);
    if (/\bUNAVAILABLE\b/.test(reply)) {
      throw new ImageGenerationFailedError(
        "image generation backend is not configured (image_generate tool unavailable)",
      );
    }
    const candidate = extractMediaPath(reply);
    if (!candidate) {
      throw new ImageGenerationFailedError(
        "generation finished but no media path was found in the reply",
      );
    }
    // Only files inside the OpenClaw media dir are servable — reject
    // anything else (also guards against a hallucinated path).
    const mediaRoot = path.resolve(this.deps.openclawStateDir, "media");
    const resolved = path.resolve(candidate);
    const relative = path.relative(mediaRoot, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new ImageGenerationFailedError(
        "generated path is outside the media directory",
      );
    }
    try {
      await access(resolved);
    } catch {
      throw new ImageGenerationFailedError(
        "generated file does not exist on disk",
      );
    }
    logger.info(
      { sessionKey, path: resolved },
      "media generation: image ready",
    );
    return {
      path: resolved,
      url: `/api/v1/media/state-file?path=${encodeURIComponent(resolved)}`,
    };
  }

  private async awaitLaneReply(
    botId: string,
    sessionKey: string,
  ): Promise<string> {
    const deadline = Date.now() + this.timeoutMs;
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
      `generation timed out after ${this.timeoutMs}ms`,
    );
  }
}
