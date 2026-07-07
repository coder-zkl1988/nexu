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
 * op node types with the two runtime-only node kinds the canvas also renders
 * (`a2ui`, `team-step`) so the mirror can faithfully report the whole board.
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

export const canvasMirrorNodeSchema = z.object({
  id: z.string().max(MIRROR_ID_MAX),
  type: canvasOpNodeTypeSchema.or(z.enum(["a2ui", "team-step"])),
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
});
export type CanvasMirror = z.infer<typeof canvasMirrorSchema>;
