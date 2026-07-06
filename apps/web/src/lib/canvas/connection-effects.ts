import {
  getBatch,
  updatePost,
} from "@/lib/a2ui/custom-components/xhs-batch-store";
import type { CanvasNode } from "./canvas-store";
import { getA2UIPayload } from "./canvas-store";

/**
 * Push-on-connect effect registry (W2.1).
 *
 * Each entry runs synchronously when two nodes are connected on the canvas.
 * This is the PUSH side of generation semantics — effects triggered by
 * the act of connecting nodes.
 *
 * The PULL side (collecting upstream resources at generate time) lives in
 * resource-references.ts (`collectUpstream`).
 *
 * To add a new push-on-connect behavior: append an entry to `effects`.
 * Existing effects are never changed here — `applyConnectionEffects` runs
 * every matching effect in order.
 */

type ConnectionEffect = {
  name: string;
  matches(source: CanvasNode, target: CanvasNode): boolean;
  apply(source: CanvasNode, target: CanvasNode): void;
};

const effects: ReadonlyArray<ConnectionEffect> = [
  {
    name: "image-to-xhs-editor",
    matches(source: CanvasNode, target: CanvasNode): boolean {
      return (
        source.type === "image" &&
        Boolean(source.metadata.content) &&
        target.type === "a2ui" &&
        Boolean(target.metadata.surfaceId)
      );
    },
    apply(source: CanvasNode, target: CanvasNode): void {
      const { surfaceId } = target.metadata;
      const image = source.metadata.content;
      if (!surfaceId || !image) return;
      const payload = getA2UIPayload(surfaceId);
      if (!payload) return;
      for (const message of payload.messages) {
        if (!("updateComponents" in message)) continue;
        for (const component of message.updateComponents?.components ?? []) {
          const comp = component as {
            type?: string;
            batchId?: string;
            postId?: string;
          };
          if (comp.type !== "XHSEditor" || !comp.batchId || !comp.postId)
            continue;
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
    },
  },
];

/**
 * Run every registered push-on-connect effect that matches the given
 * source/target pair. Called by infinite-canvas.tsx on connect-drop.
 *
 * Behavior is unchanged from the original single-effect implementation —
 * the registry shape makes it easy to add future push effects without
 * modifying this function's signature or call sites.
 */
export function applyConnectionEffects(from: CanvasNode, to: CanvasNode): void {
  for (const effect of effects) {
    if (effect.matches(from, to)) {
      effect.apply(from, to);
    }
  }
}
