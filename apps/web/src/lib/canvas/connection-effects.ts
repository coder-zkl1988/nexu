import {
  getBatch,
  updatePost,
} from "@/lib/a2ui/custom-components/xhs-batch-store";
import type { CanvasNode } from "./canvas-store";
import { getA2UIPayload } from "./canvas-store";

/**
 * Data-flow side effects for canvas connections (design doc §v2 follow-up):
 * connecting an image node INTO an XHS editor node feeds the image straight
 * into that post's image list — the canvas edge is not just visual, it moves
 * data downstream. Future generation nodes (S7) reuse this same hook.
 */
export function applyConnectionEffects(from: CanvasNode, to: CanvasNode): void {
  if (from.type !== "image" || !from.metadata.content) return;
  if (to.type !== "a2ui" || !to.metadata.surfaceId) return;

  // Locate an XHSEditor component in the target surface and read its
  // batch/post identity from the component props (robust — surfaceIds are
  // not reliably splittable).
  const payload = getA2UIPayload(to.metadata.surfaceId);
  if (!payload) return;
  for (const message of payload.messages) {
    if (!("updateComponents" in message)) continue;
    for (const component of message.updateComponents?.components ?? []) {
      const comp = component as {
        type?: string;
        batchId?: string;
        postId?: string;
      };
      if (comp.type !== "XHSEditor" || !comp.batchId || !comp.postId) continue;
      const image = from.metadata.content;
      const post = getBatch(comp.batchId).posts.find(
        (candidate) => candidate.id === comp.postId,
      );
      if (!post || post.images.includes(image)) return;
      updatePost(comp.batchId, comp.postId, {
        images: [...post.images, image],
      });
      return;
    }
  }
}
