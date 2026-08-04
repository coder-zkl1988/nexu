// nexu-canvas runtime plugin: let the chat agent drive the Nexu canvas.
//   - canvas_read(): read a compact snapshot of the current canvas (the
//     "mirror") so the agent can decide what to change. HTTP GETs the
//     controller mirror route the frontend keeps up to date.
//   - canvas_op({ ops, summary? }): emit a batch of canvas operations. This
//     plugin is a pure COURIER — it does NOT execute anything. It returns a
//     fenced ```canvas-op``` block carrying the batch JSON; the surfaced result
//     reaches the web chat (SurfacedToolResultNames), and the T6 frontend
//     shows a confirm card and applies the batch as ONE undoable step.
// See specs design docs for S8 "chat drives the canvas".

const MIRROR_PATH = "/api/v1/canvas/mirror";

/** Controller base URL, injected via plugin config by the compiler. */
let configuredControllerUrl = null;

function controllerOrigin() {
  const raw =
    configuredControllerUrl ||
    process.env.NEXU_CONTROLLER_URL ||
    process.env.CONTROLLER_URL ||
    "";
  return raw.replace(/\/+$/, "");
}

function textResult(text, isError) {
  const result = { content: [{ type: "text", text }] };
  if (isError) {
    result.isError = true;
  }
  return result;
}

/**
 * Compact, readable rendering of the mirror for the model. One legend line
 * plus terse per-node / per-connection lines — cheaper than raw JSON and
 * easier for the model to reason over. `hasContent` is surfaced as a `*`
 * marker so the agent can tell filled nodes from placeholders.
 */
function renderMirror(mirror) {
  const nodes = Array.isArray(mirror?.nodes) ? mirror.nodes : [];
  const connections = Array.isArray(mirror?.connections)
    ? mirror.connections
    : [];
  const viewport = mirror?.viewport || { x: 0, y: 0, scale: 1 };
  const selected = Array.isArray(mirror?.selectedNodeIds)
    ? mirror.selectedNodeIds
    : [];
  const lines = [];
  lines.push(
    "Canvas mirror (legend: id [type] \"title\" @x,y wxh, * = has content).",
  );
  lines.push(
    `board=${String(mirror?.boardId || "sidebar")} nodes=${nodes.length} connections=${connections.length} viewport=(${viewport.x},${viewport.y}) scale=${viewport.scale}`,
  );
  if (selected.length > 0) {
    lines.push(`selected: ${selected.join(", ")}`);
  }
  if (nodes.length === 0) {
    lines.push("(no nodes yet)");
  }
  for (const node of nodes) {
    lines.push(
      `- ${node.id} [${node.type}] ${JSON.stringify(String(node.title || ""))} @${node.x},${node.y} ${node.w}x${node.h}${node.hasContent ? " *" : ""}`,
    );
  }
  for (const conn of connections) {
    lines.push(`  ~ ${conn.id}: ${conn.from} -> ${conn.to}`);
  }
  const assets = Array.isArray(mirror?.assets) ? mirror.assets : [];
  if (assets.length > 0) {
    lines.push("assets (use insert_asset with the id):");
    for (const asset of assets) {
      const tagSuffix =
        Array.isArray(asset.tags) && asset.tags.length > 0
          ? ` tags:${asset.tags.join(",")}`
          : "";
      lines.push(
        `  # ${asset.id} [${asset.kind}] ${JSON.stringify(String(asset.title || ""))}${tagSuffix}`,
      );
    }
  }
  return lines.join("\n");
}

async function readMirror() {
  const origin = controllerOrigin();
  if (!origin) {
    return "canvas unavailable (controller URL not configured)";
  }
  try {
    const res = await fetch(`${origin}${MIRROR_PATH}`);
    if (!res.ok) {
      return `canvas unavailable (mirror request failed: ${res.status})`;
    }
    const mirror = await res.json();
    return renderMirror(mirror);
  } catch {
    return "canvas unavailable (mirror request failed)";
  }
}

/**
 * Build the courier result for a validated batch: a fenced ```canvas-op``` block
 * carrying JSON.stringify({ ops, summary }) plus a short instruction so the
 * model stops after emitting the batch (the frontend confirm card owns the
 * apply). Exported for unit testing the exact surfaced shape.
 */
function buildCanvasOpResult(ops, summary) {
  const payload =
    summary === undefined
      ? JSON.stringify({ ops })
      : JSON.stringify({ ops, summary });
  return {
    content: [
      { type: "text", text: ["```canvas-op", payload, "```"].join("\n") },
      {
        type: "text",
        text: JSON.stringify({
          proposed: true,
          opCount: ops.length,
          note: "The canvas edit is proposed to the user as a confirm card. Reply with ONE short confirmation sentence. Do NOT restate every op, and do NOT call canvas_op again for the same edit. If the user later clicks apply and it partially or fully fails, you will receive a follow-up user-role message shaped {type:\"canvas_op_result\",applied,errors}: applied ops did happen, but each string in errors describes one op that did NOT (e.g. an unknown node id or a duplicate edge) — explain the failure in plain language and, if the fix is obvious (a stale id, a backwards connect direction), propose a corrected canvas_op.",
        }),
      },
    ],
  };
}

const CANVAS_READ_DESCRIPTION = `Read a compact snapshot of the Nexu canvas (the visual workbench in the sidebar): every node's id, type, title, position and whether it has content, plus connections, viewport and selection. It ALSO returns the saved asset library (each asset's id / kind / title) — pass one of those ids to insert_asset to place a saved asset back on the canvas. NO arguments.

ALWAYS call this before canvas_op so you target real node ids and place new nodes where they fit. Returns a short "canvas unavailable" line if the canvas can't be read (then skip canvas edits).`;

export const CANVAS_OP_DESCRIPTION = `Emit a batch of canvas operations to edit the Nexu canvas (structural edits, image editing, and asset-library save/insert). The batch is PROPOSED to the user as a confirm card and, once confirmed, applied as ONE undoable step.

SCOPE BOUNDARY: use this only when the user explicitly wants to edit the canvas or refers to canvas nodes. A chat XHSEditor or XHSBatchTable is NOT a canvas node. To add a generated image to one of those chat components, call image_generate, wait for the real media path, then call render_a2ui with the SAME surfaceId and updated images. NEVER use canvas_read or canvas_op for that workflow.

READ FIRST: call canvas_read to get current node ids (and saved asset ids) before referencing them.
WIRING NEW NODES: give each add_node (or insert_asset) a client-chosen "ref" handle; later ops in the SAME batch target that new node with "ref:<name>" (e.g. add_node ref "a", then connect from "ref:a" to an existing node id). target / from / to accept a real node id OR "ref:<name>".
CONNECTION DIRECTION: connect{from,to} means "from" FEEDS "to" — an edge INTO a node is what that node's own generation/config reads as upstream input (text -> prompt, image -> reference image). To feed a text or image node into a generation/config node, "from" must be the text/image node and "to" must be the node it feeds. Wiring it backwards creates a valid edge that silently contributes nothing.
Ops:
- structural: add_node{ref,nodeType,title?,x?,y?,content?}; update_node{target,title?,x?,y?,w?,h?,content?}; delete_node{target}; connect{from,to}; delete_connection{connectionId}; set_viewport{x,y,scale}; select{targets[]}; run_generation{target,prompt?}. nodeType ∈ text|image|video|audio|config.
- image editing (on an existing image node): crop_image{target,x,y,w,h}; split_image{target,rows,cols}; upscale_image{target,targetLongEdge:1024|2048|4096,algorithm:high|low|pixel}; enhance_image{target,operation:super-resolve|multi-angle,targetLongEdge?,horizontalDeg?,pitchDeg?,distance?,wideAngle?,prompt?}; describe_image{target}.
- asset library: save_asset{target,tags?} (store a node's content as a reusable asset; tags = up to 8 short labels for library filtering); insert_asset{assetId,ref?,x?,y?} (assetId comes from canvas_read's asset list).
enhance_image / describe_image need a servable image (a generated/served image, not a freshly uploaded dataURL).
Keep batches focused (≤50 ops). After calling, reply with one short confirmation — do not restate the ops.`;

const plugin = {
  id: "nexu-canvas",
  name: "Nexu Canvas Operations",
  description:
    "Registers canvas_read / canvas_op so the chat agent can read the Nexu canvas and propose a batch of canvas operations the frontend applies as one undoable step.",
  register(api) {
    const cfg = api && api.pluginConfig;
    if (cfg && typeof cfg.controllerUrl === "string" && cfg.controllerUrl) {
      configuredControllerUrl = cfg.controllerUrl;
    }

    // Factory form. NOTE: factory registrations MUST pass opts.names (matching
    // manifest contracts.tools) — without it the registry records zero tool
    // names and no agent ever sees the tools.
    const registerCanvasTools = () => [
      {
        name: "canvas_read",
        label: "Read Canvas",
        description: CANVAS_READ_DESCRIPTION,
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {},
        },
        async execute() {
          return textResult(await readMirror());
        },
      },
      {
        name: "canvas_op",
        label: "Edit Canvas",
        description: CANVAS_OP_DESCRIPTION,
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            ops: {
              type: "array",
              description:
                "The batch of canvas operations. Each item has a string `op` discriminator — structural (add_node, update_node, delete_node, connect, delete_connection, set_viewport, select, run_generation), image editing (crop_image, split_image, upscale_image, enhance_image, describe_image), or asset library (save_asset, insert_asset). See the tool description for each op's fields.",
              items: { type: "object" },
            },
            summary: {
              type: "string",
              description:
                "Optional one-line summary of the edit, shown on the confirm card.",
            },
          },
          required: ["ops"],
        },
        async execute(_toolCallId, params) {
          const ops = params && Array.isArray(params.ops) ? params.ops : null;
          if (!ops || ops.length === 0) {
            return textResult(
              JSON.stringify({
                error:
                  "canvas_op requires a non-empty `ops` array. Call canvas_read first, then pass at least one operation.",
              }),
              true,
            );
          }
          const invalid = ops.find(
            (op) => !op || typeof op !== "object" || typeof op.op !== "string",
          );
          if (invalid !== undefined) {
            return textResult(
              JSON.stringify({
                error:
                  "each canvas op must be an object with a string `op` field (a structural, image-editing, or asset-library op — see the canvas_op tool description for the full menu).",
              }),
              true,
            );
          }
          const summary =
            params && typeof params.summary === "string"
              ? params.summary
              : undefined;
          return buildCanvasOpResult(ops, summary);
        },
      },
    ];
    api.registerTool(registerCanvasTools, {
      names: ["canvas_read", "canvas_op"],
    });
  },
};

export default plugin;
export { buildCanvasOpResult, renderMirror };
