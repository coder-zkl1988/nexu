import { z } from "zod";

/**
 * S8 "chat drives the canvas" op protocol + mirror schemas.
 *
 * The canvas lives in the web frontend; the agent runs in the OpenClaw runtime.
 * Two tools bridge them (nexu-canvas runtime plugin):
 *   - canvas_read reads a compact snapshot of the canvas (the "mirror").
 *   - canvas_op emits a batch of operations the frontend executes as one
 *     undoable step after the user confirms.
 *
 * These schemas are the wire contract for both directions:
 *   - {@link canvasOpBatchSchema} — what the agent emits (validated by the
 *     frontend executor in T6).
 *   - {@link canvasMirrorSchema} — the compact state the frontend pushes to the
 *     controller and the plugin's canvas_read reads back.
 */

/** Base node type the agent can create/target. Matches the web CanvasNodeType base set. */
export const canvasOpNodeTypeSchema = z.enum([
  "text",
  "image",
  "video",
  "audio",
  "config",
]);
export type CanvasOpNodeType = z.infer<typeof canvasOpNodeTypeSchema>;

/**
 * A single canvas operation. Discriminated on `op`.
 *
 * `ref` (add_node) is a client-chosen handle so later ops in the SAME batch can
 * target the just-created node via `"ref:<ref>"` before it has a real id.
 * `target` / `from` / `to` accept a real node id OR `"ref:<ref>"`.
 */
export const canvasOpSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("add_node"),
    ref: z.string().min(1).max(64),
    nodeType: canvasOpNodeTypeSchema,
    title: z.string().max(200).optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    content: z.string().max(20000).optional(),
  }),
  z.object({
    op: z.literal("update_node"),
    target: z.string().min(1),
    title: z.string().max(200).optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    /** Resize the node. Store clamps to its per-type minimums. */
    w: z.number().positive().max(10000).optional(),
    h: z.number().positive().max(10000).optional(),
    content: z.string().max(20000).optional(),
  }),
  z.object({
    op: z.literal("delete_node"),
    target: z.string().min(1),
  }),
  z.object({
    op: z.literal("connect"),
    from: z.string().min(1),
    to: z.string().min(1),
  }),
  z.object({
    op: z.literal("delete_connection"),
    connectionId: z.string().min(1),
  }),
  z.object({
    op: z.literal("set_viewport"),
    x: z.number(),
    y: z.number(),
    scale: z.number().min(0.05).max(5),
  }),
  z.object({
    op: z.literal("select"),
    targets: z.array(z.string().min(1)).max(200),
  }),
  z.object({
    op: z.literal("run_generation"),
    target: z.string().min(1),
    prompt: z.string().max(20000).optional(),
  }),
  // ── Image-editing ops (image-ops B) ────────────────────────────
  // Each edits an existing image node. The frontend executor defers them
  // (async: load bitmap / call backend) after the sync structural loop, exactly
  // like run_generation, so they never split the one-undo step. `target`
  // accepts a real node id OR `"ref:<ref>"` like the other ops.
  z.object({
    op: z.literal("crop_image"),
    target: z.string().min(1),
    x: z.number(),
    y: z.number(),
    w: z.number().positive().max(20000),
    h: z.number().positive().max(20000),
  }),
  z.object({
    op: z.literal("split_image"),
    target: z.string().min(1),
    rows: z.number().int().min(1).max(12),
    cols: z.number().int().min(1).max(12),
  }),
  z.object({
    op: z.literal("upscale_image"),
    target: z.string().min(1),
    targetLongEdge: z.union([
      z.literal(1024),
      z.literal(2048),
      z.literal(4096),
    ]),
    algorithm: z.enum(["high", "low", "pixel"]),
  }),
  z.object({
    op: z.literal("enhance_image"),
    target: z.string().min(1),
    operation: z.enum(["super-resolve", "multi-angle"]),
    targetLongEdge: z
      .union([z.literal(1024), z.literal(2048), z.literal(4096)])
      .optional(),
    horizontalDeg: z.number().min(-60).max(60).optional(),
    pitchDeg: z.number().min(-45).max(45).optional(),
    distance: z.number().min(1).max(10).optional(),
    wideAngle: z.boolean().optional(),
    prompt: z.string().max(2000).optional(),
  }),
  z.object({
    op: z.literal("describe_image"),
    target: z.string().min(1),
  }),
  // ── Asset-library ops (W7) ─────────────────────────────────────
  // save_asset stores a node's content in the asset library (async storage
  // write → the executor DEFERS it after the sync loop, like run_generation).
  // insert_asset places a saved asset back on the canvas as a new node; it is
  // SYNCHRONOUS so the created node is ref-able and joins the one-undo batch.
  z.object({
    op: z.literal("save_asset"),
    target: z.string().min(1),
    /** Optional labels stored on the asset for library filtering. */
    tags: z.array(z.string().min(1).max(24)).max(8).optional(),
  }),
  z.object({
    op: z.literal("insert_asset"),
    assetId: z.string().min(1),
    ref: z.string().min(1).max(64).optional(),
    x: z.number().optional(),
    y: z.number().optional(),
  }),
]);
export type CanvasOp = z.infer<typeof canvasOpSchema>;

/** A batch of ops the agent emits; applied as one undoable step after confirm. */
export const canvasOpBatchSchema = z.object({
  ops: z.array(canvasOpSchema).min(1).max(50),
  summary: z.string().max(500).optional(),
});
export type CanvasOpBatch = z.infer<typeof canvasOpBatchSchema>;

/**
 * One node in the compact mirror the frontend pushes. `type` widens the base
 * op node types with the runtime-only node kinds the canvas also renders
 * (`a2ui`, `team-step`, `xhs`, `phone`, `group`) so the mirror can faithfully
 * report the whole
 * board. This widening is MIRROR-ONLY: `group` is deliberately absent from
 * `canvasOpNodeTypeSchema` (the agent's add_node surface) — the agent reads
 * groups via the mirror but does not create them.
 */
/**
 * Defense-in-depth caps for the mirror. The POST /api/v1/canvas/mirror route is
 * unauthenticated (loopback, single-user model), so these bound what a runaway
 * or malformed push can hold in the in-memory singleton. Generous enough to
 * never reject a real sidebar board; they only stop unbounded input.
 */
const MIRROR_ID_MAX = 200;
const MIRROR_TITLE_MAX = 1000;
const MIRROR_NODES_MAX = 5000;
const MIRROR_CONNECTIONS_MAX = 10000;
const MIRROR_ASSETS_MAX = 2000;

export const canvasMirrorNodeSchema = z.object({
  id: z.string().max(MIRROR_ID_MAX),
  type: canvasOpNodeTypeSchema.or(
    z.enum(["a2ui", "team-step", "xhs", "phone", "group"]),
  ),
  title: z.string().max(MIRROR_TITLE_MAX),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  hasContent: z.boolean(),
});
export type CanvasMirrorNode = z.infer<typeof canvasMirrorNodeSchema>;

export const canvasMirrorConnectionSchema = z.object({
  id: z.string().max(MIRROR_ID_MAX),
  from: z.string().max(MIRROR_ID_MAX),
  to: z.string().max(MIRROR_ID_MAX),
});
export type CanvasMirrorConnection = z.infer<
  typeof canvasMirrorConnectionSchema
>;

/**
 * One saved asset in the compact mirror. Only id/kind/title/tags are surfaced
 * so the agent can reference an asset with insert_asset — the asset content
 * itself is never leaked into the mirror.
 */
export const canvasMirrorAssetSchema = z.object({
  id: z.string().max(MIRROR_ID_MAX),
  kind: z.enum(["text", "image", "video", "audio"]),
  title: z.string().max(MIRROR_TITLE_MAX),
  tags: z.array(z.string().min(1).max(24)).max(8).optional(),
});
export type CanvasMirrorAsset = z.infer<typeof canvasMirrorAssetSchema>;

/** Compact snapshot of the active canvas board. Single active board only. */
export const canvasMirrorSchema = z.object({
  boardId: z.string().max(MIRROR_ID_MAX),
  nodes: z.array(canvasMirrorNodeSchema).max(MIRROR_NODES_MAX),
  connections: z
    .array(canvasMirrorConnectionSchema)
    .max(MIRROR_CONNECTIONS_MAX),
  viewport: z.object({
    x: z.number(),
    y: z.number(),
    scale: z.number(),
  }),
  selectedNodeIds: z.array(z.string().max(MIRROR_ID_MAX)).max(MIRROR_NODES_MAX),
  // Saved asset library (id/kind/title only). `.default([])` keeps back-compat:
  // an older frontend push (or the empty default) that omits `assets` parses to
  // an empty array rather than failing validation.
  assets: z.array(canvasMirrorAssetSchema).max(MIRROR_ASSETS_MAX).default([]),
});
export type CanvasMirror = z.infer<typeof canvasMirrorSchema>;
