/**
 * canvas-generation.ts
 *
 * UI-free generation seam. All later generation flows (prompt panel T4, Config
 * node T5, batch T6) extend this module — keep it clean and typed.
 *
 * Imports: sdk.gen (API calls) + canvas-store (state) only.
 */

import { postApiV1MediaGenerateImage } from "../../../lib/api/sdk.gen";
import { getCanvasState, setNodeTask, updateNode } from "./canvas-store";

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
): Promise<boolean> {
  setNodeTask(nodeId, {
    status: "generating",
    retry: { kind: "image", prompt },
  });

  try {
    const { data, error } = await postApiV1MediaGenerateImage({
      body: { prompt },
    });

    // Check if the node still exists (may have been deleted during the async call).
    const stillExists = getCanvasState().nodes.some((n) => n.id === nodeId);
    if (!stillExists) return false;

    if (!data || error) {
      setNodeTask(nodeId, {
        status: "error",
        error: "生成失败，请重试",
        retry: { kind: "image", prompt },
      });
      return false;
    }

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
      retry: { kind: "image", prompt },
    });
    return false;
  }
}

/**
 * Fire-and-forget retry: reads the node's `task.retry` and re-runs the
 * matching generation. No-op if the node has no retry payload or doesn't exist.
 */
export function retryNodeTask(nodeId: string): void {
  const node = getCanvasState().nodes.find((n) => n.id === nodeId);
  const retry = node?.metadata.task?.retry;
  if (!retry) return;
  if (retry.kind === "image") {
    void generateImageIntoNode(nodeId, retry.prompt);
  }
}
