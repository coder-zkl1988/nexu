/**
 * config-node-logic.ts
 *
 * Pure plan builder for the config generation node (W2.4).
 *
 * Reads the config node's metadata.config + upstream resources, assembles a
 * typed plan, then dispatches to the matching generation seam.
 *
 * NOTE: model/aspect-ratio pickers are intentionally absent — the channels
 * do not accept those params yet. Add them when the channels do.
 */

import {
  generateAudioIntoNode,
  generateImageIntoNode,
  generateVideoIntoNode,
} from "./canvas-generation";
import { addNode, connectNodes, getCanvasState } from "./canvas-store";
import { usableReferencePaths } from "./prompt-panel-utils";
import { collectUpstream } from "./resource-references";

// ── Plan types ─────────────────────────────────────────────────

export type ConfigGenerationPlan =
  | {
      kind: "image";
      prompt: string;
      referenceImages: string[];
      count?: number;
    }
  | {
      kind: "video";
      prompt: string;
      durationSeconds?: number;
      resolution?: "720p" | "1080p";
    }
  | {
      kind: "audio";
      prompt: string;
      voice?: string;
      speed?: number;
    };

type PlanError = { error: "no-config" | "no-prompt" };

// ── buildConfigGenerationPlan ──────────────────────────────────

/**
 * Build a typed generation plan from the config node's current state.
 *
 * - Reads `metadata.config` for mode/params.
 * - Reads upstream resources: prompts joined with `"\n\n"` (trimmed items),
 *   images filtered through `usableReferencePaths`.
 * - Returns `{ error: "no-config" }` if `metadata.config` is absent.
 * - Returns `{ error: "no-prompt" }` if upstream produces no non-empty prompt.
 */
export function buildConfigGenerationPlan(
  nodeId: string,
): ConfigGenerationPlan | PlanError {
  const node = getCanvasState().nodes.find((n) => n.id === nodeId);
  if (!node?.metadata.config) return { error: "no-config" };

  const cfg = node.metadata.config;
  const upstream = collectUpstream(nodeId);

  // Join trimmed upstream text items with double newline.
  const prompt = upstream.prompts
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .join("\n\n");

  if (prompt.length === 0) return { error: "no-prompt" };

  if (cfg.mode === "image") {
    const referenceImages = usableReferencePaths(upstream.images);
    return {
      kind: "image",
      prompt,
      referenceImages,
      ...(cfg.count !== undefined ? { count: cfg.count } : {}),
    };
  }

  if (cfg.mode === "video") {
    return {
      kind: "video",
      prompt,
      ...(cfg.durationSeconds !== undefined
        ? { durationSeconds: cfg.durationSeconds }
        : {}),
      ...(cfg.resolution !== undefined ? { resolution: cfg.resolution } : {}),
    };
  }

  // audio
  return {
    kind: "audio",
    prompt,
    ...(cfg.voice !== undefined ? { voice: cfg.voice } : {}),
    ...(cfg.speed !== undefined ? { speed: cfg.speed } : {}),
  };
}

// ── runConfigGeneration ────────────────────────────────────────

/**
 * Build the plan, create a downstream result node, connect config→result,
 * then dispatch the matching generation seam into the result node.
 *
 * Returns the seam's promise on success, or null on plan error (no-config /
 * no-prompt).
 *
 * Result node position: config.x + config.width + 60, config.y.
 *
 * NOTE: concurrent 生成 clicks create separate result nodes (acceptable v1).
 */
export function runConfigGeneration(
  configNodeId: string,
): Promise<boolean> | null {
  const plan = buildConfigGenerationPlan(configNodeId);
  if ("error" in plan) return null;

  const configNode = getCanvasState().nodes.find((n) => n.id === configNodeId);
  if (!configNode) return null;

  const resultPosition = {
    x: configNode.position.x + configNode.size.width + 60,
    y: configNode.position.y,
  };

  const resultNode = addNode({
    type: plan.kind,
    title: "生成结果",
    position: resultPosition,
  });

  connectNodes(configNodeId, resultNode.id);

  if (plan.kind === "image") {
    return generateImageIntoNode(resultNode.id, plan.prompt, {
      referenceImages: plan.referenceImages,
      ...(plan.count !== undefined ? { count: plan.count } : {}),
    });
  }

  if (plan.kind === "video") {
    return generateVideoIntoNode(resultNode.id, plan.prompt, {
      ...(plan.durationSeconds !== undefined
        ? { durationSeconds: plan.durationSeconds }
        : {}),
      ...(plan.resolution !== undefined ? { resolution: plan.resolution } : {}),
    });
  }

  // audio
  return generateAudioIntoNode(resultNode.id, plan.prompt, {
    ...(plan.voice !== undefined ? { voice: plan.voice } : {}),
    ...(plan.speed !== undefined ? { speed: plan.speed } : {}),
  });
}
