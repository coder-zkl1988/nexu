/**
 * canvas-generation.ts
 *
 * UI-free generation seam. All later generation flows (prompt panel T4, Config
 * node T5, batch T6) extend this module — keep it clean and typed.
 *
 * Imports: sdk.gen (API calls) + canvas-store (state) only.
 */

import {
  postApiV1MediaGenerateAudio,
  postApiV1MediaGenerateImage,
  postApiV1MediaGenerateVideo,
} from "../../../lib/api/sdk.gen";
import { getCanvasState, setNodeTask, updateNode } from "./canvas-store";

// ── Image ──────────────────────────────────────────────────────

/**
 * Kick off an image generation into `nodeId`.
 *
 * 1. Sets the node's task to `generating` (with retry params).
 * 2. Calls the generate-image SDK endpoint.
 * 3. On success: writes `content` + `title` to the node, clears the task.
 * 4. On failure/throw: sets task to `error` with retry payload.
 * 5. If the node was deleted before the response arrives, does nothing.
 *
 * Returns `true` on success, `false` on failure.
 */
export async function generateImageIntoNode(
  nodeId: string,
  prompt: string,
  opts?: { referenceImages?: string[]; count?: number },
): Promise<boolean> {
  const retry = {
    kind: "image" as const,
    prompt,
    ...(opts?.referenceImages !== undefined
      ? { referenceImages: opts.referenceImages }
      : {}),
    ...(opts?.count !== undefined ? { count: opts.count } : {}),
  };

  setNodeTask(nodeId, { status: "generating", retry });

  try {
    const { data, error } = await postApiV1MediaGenerateImage({
      body: {
        prompt,
        ...(opts?.referenceImages !== undefined
          ? { referenceImages: opts.referenceImages }
          : {}),
        ...(opts?.count !== undefined ? { count: opts.count } : {}),
      },
    });

    // Check if the node still exists (may have been deleted during the async call).
    const stillExists = getCanvasState().nodes.some((n) => n.id === nodeId);
    if (!stillExists) return false;

    if (!data || error) {
      setNodeTask(nodeId, {
        status: "error",
        error: "生成失败，请重试",
        retry,
      });
      return false;
    }

    // T6: batch fan-out — when items.length > 1, only the first item is set here;
    // batch grouping will be handled in task T6.
    updateNode(nodeId, {
      title: prompt.slice(0, 30),
      metadata: { content: data.url },
    });
    setNodeTask(nodeId, null);
    return true;
  } catch {
    // Check node existence before writing error state.
    const stillExists = getCanvasState().nodes.some((n) => n.id === nodeId);
    if (!stillExists) return false;

    setNodeTask(nodeId, {
      status: "error",
      error: "生成失败，请重试",
      retry,
    });
    return false;
  }
}

// ── Video ──────────────────────────────────────────────────────

/**
 * Kick off a video generation into `nodeId`.
 * Lifecycle mirrors generateImageIntoNode: generating → content=url + clear / error+retry.
 * Returns `true` on success, `false` on failure.
 */
export async function generateVideoIntoNode(
  nodeId: string,
  prompt: string,
  opts?: { durationSeconds?: number; resolution?: "720p" | "1080p" },
): Promise<boolean> {
  const retry = {
    kind: "video" as const,
    prompt,
    ...(opts?.durationSeconds !== undefined
      ? { durationSeconds: opts.durationSeconds }
      : {}),
    ...(opts?.resolution !== undefined ? { resolution: opts.resolution } : {}),
  };

  setNodeTask(nodeId, { status: "generating", retry });

  try {
    const { data, error } = await postApiV1MediaGenerateVideo({
      body: {
        prompt,
        ...(opts?.durationSeconds !== undefined
          ? { durationSeconds: opts.durationSeconds }
          : {}),
        ...(opts?.resolution !== undefined
          ? { resolution: opts.resolution }
          : {}),
      },
    });

    const stillExists = getCanvasState().nodes.some((n) => n.id === nodeId);
    if (!stillExists) return false;

    if (!data || error) {
      setNodeTask(nodeId, {
        status: "error",
        error: "生成失败，请重试",
        retry,
      });
      return false;
    }

    // T6: batch fan-out — when items.length > 1, only the first item is set here;
    // batch grouping will be handled in task T6.
    updateNode(nodeId, {
      title: prompt.slice(0, 30),
      metadata: { content: data.url },
    });
    setNodeTask(nodeId, null);
    return true;
  } catch {
    const stillExists = getCanvasState().nodes.some((n) => n.id === nodeId);
    if (!stillExists) return false;

    setNodeTask(nodeId, {
      status: "error",
      error: "生成失败，请重试",
      retry,
    });
    return false;
  }
}

// ── Audio ──────────────────────────────────────────────────────

/**
 * Kick off an audio generation into `nodeId`.
 * Lifecycle mirrors generateImageIntoNode: generating → content=url + clear / error+retry.
 * Returns `true` on success, `false` on failure.
 */
export async function generateAudioIntoNode(
  nodeId: string,
  prompt: string,
  opts?: { voice?: string; speed?: number },
): Promise<boolean> {
  const retry = {
    kind: "audio" as const,
    prompt,
    ...(opts?.voice !== undefined ? { voice: opts.voice } : {}),
    ...(opts?.speed !== undefined ? { speed: opts.speed } : {}),
  };

  setNodeTask(nodeId, { status: "generating", retry });

  try {
    const { data, error } = await postApiV1MediaGenerateAudio({
      body: {
        prompt,
        ...(opts?.voice !== undefined ? { voice: opts.voice } : {}),
        ...(opts?.speed !== undefined ? { speed: opts.speed } : {}),
      },
    });

    const stillExists = getCanvasState().nodes.some((n) => n.id === nodeId);
    if (!stillExists) return false;

    if (!data || error) {
      setNodeTask(nodeId, {
        status: "error",
        error: "生成失败，请重试",
        retry,
      });
      return false;
    }

    // T6: batch fan-out — when items.length > 1, only the first item is set here;
    // batch grouping will be handled in task T6.
    updateNode(nodeId, {
      title: prompt.slice(0, 30),
      metadata: { content: data.url },
    });
    setNodeTask(nodeId, null);
    return true;
  } catch {
    const stillExists = getCanvasState().nodes.some((n) => n.id === nodeId);
    if (!stillExists) return false;

    setNodeTask(nodeId, {
      status: "error",
      error: "生成失败，请重试",
      retry,
    });
    return false;
  }
}

// ── Retry ──────────────────────────────────────────────────────

/**
 * Fire-and-forget retry: reads the node's `task.retry` and re-runs the
 * matching generation. No-op if the node has no retry payload or doesn't exist.
 */
export function retryNodeTask(nodeId: string): void {
  const node = getCanvasState().nodes.find((n) => n.id === nodeId);
  const retry = node?.metadata.task?.retry;
  if (!retry) return;
  if (retry.kind === "image") {
    void generateImageIntoNode(nodeId, retry.prompt, {
      referenceImages: retry.referenceImages,
      count: retry.count,
    });
  } else if (retry.kind === "video") {
    void generateVideoIntoNode(nodeId, retry.prompt, {
      durationSeconds: retry.durationSeconds,
      resolution: retry.resolution,
    });
  } else if (retry.kind === "audio") {
    void generateAudioIntoNode(nodeId, retry.prompt, {
      voice: retry.voice,
      speed: retry.speed,
    });
  }
}
