/**
 * canvas-ops-executor.ts
 *
 * S8 "chat drives the canvas" (W4.5b) — applies a validated canvas-op batch to
 * the store.
 *
 * Two guarantees:
 *   1. ONE undo step. Structural ops (add/update/move/delete/connect/viewport/
 *      select) run SYNCHRONOUSLY in a tight loop; the store's 400ms history
 *      debounce coalesces the whole burst into a single undo entry. We do NOT
 *      touch history here — the store owns it.
 *   2. run_generation is async. Generation seams are collected during the sync
 *      loop and fired AFTER it, fire-and-forget (never joined) so they never
 *      split the undo step or block confirmation.
 *
 * Ref resolution: add_node assigns a client-chosen `ref`; later ops in the SAME
 * batch target the new node via `"ref:<ref>"`. Targets without the `ref:` prefix
 * are treated as real node ids and verified against the live state.
 *
 * Defense in depth: parseCanvasOpBlock re-validates the agent's block through
 * canvasOpBatchSchema — the plugin courier does only minimal validation.
 */

import { type CanvasOp, canvasOpBatchSchema } from "@nexu/shared";
import { generateImageIntoNode } from "./canvas-generation";
import {
  type CanvasNodeType,
  addNode,
  cascadePosition,
  connectNodes,
  getCanvasState,
  moveNode,
  removeConnection,
  removeNodes,
  selectNodes,
  setViewport,
  updateNode,
} from "./canvas-store";
import { runConfigGeneration } from "./config-node-logic";

export interface CanvasOpBatchInput {
  ops: CanvasOp[];
  summary?: string;
}

export interface ApplyResult {
  applied: number;
  errors: string[];
}

/** Default node title per type when the agent omits one. */
const DEFAULT_TITLE: Record<CanvasNodeType, string> = {
  a2ui: "组件",
  text: "文本",
  image: "图片",
  video: "视频",
  audio: "音频",
  "team-step": "步骤",
  config: "生成配置",
};

/**
 * Apply a canvas-op batch to the store. Structural ops run synchronously (one
 * undo step); run_generation dispatches after, fire-and-forget. Failed ops push
 * a human-readable string into `errors` and are skipped — partial application is
 * fine, the agent sees the result in the next mirror push.
 */
export function applyCanvasOps(batch: CanvasOpBatchInput): ApplyResult {
  const refs = new Map<string, string>();
  const errors: string[] = [];
  let applied = 0;
  // Collected run_generation dispatches — fired after the sync structural loop
  // so they cannot split the coalesced undo step.
  const deferredGenerations: Array<() => void> = [];

  /**
   * Resolve a target token to a real node id. `"ref:x"` → the id add_node
   * recorded for ref `x`; anything else → a real id verified against state.
   * Returns null (and pushes an error) when unresolved.
   */
  const resolveTarget = (token: string): string | null => {
    if (token.startsWith("ref:")) {
      const realId = refs.get(token.slice(4));
      if (!realId) {
        errors.push(`未知引用：${token}`);
        return null;
      }
      return realId;
    }
    const exists = getCanvasState().nodes.some((node) => node.id === token);
    if (!exists) {
      errors.push(`未找到节点：${token}`);
      return null;
    }
    return token;
  };

  for (const op of batch.ops) {
    switch (op.op) {
      case "add_node": {
        const node = addNode({
          type: op.nodeType,
          title: op.title ?? DEFAULT_TITLE[op.nodeType],
          position:
            op.x !== undefined || op.y !== undefined
              ? {
                  x: op.x ?? cascadePosition(getCanvasState().nodes.length).x,
                  y: op.y ?? cascadePosition(getCanvasState().nodes.length).y,
                }
              : cascadePosition(getCanvasState().nodes.length),
          metadata: op.content !== undefined ? { content: op.content } : {},
        });
        refs.set(op.ref, node.id);
        applied += 1;
        break;
      }
      case "update_node": {
        const id = resolveTarget(op.target);
        if (!id) break;
        if (op.x !== undefined || op.y !== undefined) {
          const current = getCanvasState().nodes.find((n) => n.id === id);
          if (current) {
            moveNode(id, {
              x: op.x ?? current.position.x,
              y: op.y ?? current.position.y,
            });
          }
        }
        if (op.title !== undefined || op.content !== undefined) {
          updateNode(id, {
            ...(op.title !== undefined ? { title: op.title } : {}),
            ...(op.content !== undefined
              ? { metadata: { content: op.content } }
              : {}),
          });
        }
        applied += 1;
        break;
      }
      case "delete_node": {
        const id = resolveTarget(op.target);
        if (!id) break;
        removeNodes([id]);
        applied += 1;
        break;
      }
      case "connect": {
        const fromId = resolveTarget(op.from);
        const toId = resolveTarget(op.to);
        if (!fromId || !toId) break;
        const connection = connectNodes(fromId, toId);
        if (!connection) {
          errors.push(`无法连接（重复或无效边）：${op.from} → ${op.to}`);
          break;
        }
        applied += 1;
        break;
      }
      case "delete_connection": {
        const exists = getCanvasState().connections.some(
          (c) => c.id === op.connectionId,
        );
        if (!exists) {
          errors.push(`未找到连接：${op.connectionId}`);
          break;
        }
        removeConnection(op.connectionId);
        applied += 1;
        break;
      }
      case "set_viewport": {
        setViewport({ x: op.x, y: op.y, scale: op.scale });
        applied += 1;
        break;
      }
      case "select": {
        const resolved: string[] = [];
        for (const target of op.targets) {
          const id = resolveTarget(target);
          if (id) resolved.push(id);
        }
        selectNodes(resolved);
        applied += 1;
        break;
      }
      case "run_generation": {
        const id = resolveTarget(op.target);
        if (!id) break;
        const node = getCanvasState().nodes.find((n) => n.id === id);
        if (!node) break;
        const prompt = op.prompt;
        if (node.type === "config") {
          deferredGenerations.push(() => {
            void runConfigGeneration(id);
          });
        } else {
          deferredGenerations.push(() => {
            void generateImageIntoNode(id, prompt ?? node.title);
          });
        }
        applied += 1;
        break;
      }
    }
  }

  // Fire generations AFTER the synchronous structural batch. These are async and
  // intentionally not joined — they do not block confirmation and their side
  // effects are out of scope for the one-undo-step guarantee.
  for (const run of deferredGenerations) run();

  return { applied, errors };
}

/**
 * Extract the FIRST ```canvas-op``` fenced block from `text`, JSON.parse it, and
 * re-validate through canvasOpBatchSchema. Returns the parsed batch, or null if
 * there is no block / the JSON is malformed / the schema rejects it.
 */
export function parseCanvasOpBlock(text: string): CanvasOpBatchInput | null {
  const match = text.match(/```canvas-op\n([\s\S]*?)```/);
  if (!match?.[1]) return null;
  let json: unknown;
  try {
    json = JSON.parse(match[1].trim());
  } catch {
    return null;
  }
  const parsed = canvasOpBatchSchema.safeParse(json);
  if (!parsed.success) return null;
  return parsed.data;
}
