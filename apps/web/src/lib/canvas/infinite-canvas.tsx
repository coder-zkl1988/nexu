import { A2UIRenderer } from "@/lib/a2ui";
import { cn } from "@/lib/utils";
import {
  AudioLines,
  Clapperboard,
  ImagePlus,
  Maximize2,
  Redo2,
  Trash2,
  Type,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  type CanvasNode,
  type CanvasViewport,
  addNode,
  clearCanvas,
  clearSelection,
  connectNodes,
  deleteSelection,
  getA2UIPayload,
  moveNode,
  redo,
  removeConnection,
  removeNodes,
  resizeNode,
  selectAll,
  selectConnection,
  selectNodes,
  setViewport,
  undo,
  updateNode,
  useCanvas,
} from "./canvas-store";
import { applyConnectionEffects } from "./connection-effects";
import { TeamStepNodeContent } from "./team-step-node";

/**
 * Canvas v2 surface — pannable/zoomable plane with typed nodes, free
 * connections (right edge → left edge, bezier), marquee multi-select,
 * corner resize, keyboard shortcuts and a bottom toolbar. Zero deps,
 * DOM-based; interaction paradigm follows the reference infinite-canvas app
 * (AGPL — reimplemented, no code reuse). Design doc
 * 2026-07-03-infinite-canvas-sidebar.md.
 */

export const CANVAS_MIN_SCALE = 0.25;
export const CANVAS_MAX_SCALE = 2;

export function clampScale(scale: number): number {
  return Math.min(CANVAS_MAX_SCALE, Math.max(CANVAS_MIN_SCALE, scale));
}

/** Zoom keeping the canvas point under `pointer` (container coords) fixed. */
export function zoomAtPoint(
  viewport: CanvasViewport,
  pointer: { x: number; y: number },
  nextScaleRaw: number,
): CanvasViewport {
  const nextScale = clampScale(nextScaleRaw);
  const worldX = (pointer.x - viewport.x) / viewport.scale;
  const worldY = (pointer.y - viewport.y) / viewport.scale;
  return {
    scale: nextScale,
    x: pointer.x - worldX * nextScale,
    y: pointer.y - worldY * nextScale,
  };
}

/** Viewport fitting all nodes inside `container` with padding. */
export function fitViewport(
  nodes: ReadonlyArray<Pick<CanvasNode, "position" | "size">>,
  container: { width: number; height: number },
  padding = 32,
): CanvasViewport {
  if (nodes.length === 0 || container.width <= 0 || container.height <= 0) {
    return { x: 0, y: 0, scale: 1 };
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const node of nodes) {
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x + node.size.width);
    maxY = Math.max(maxY, node.position.y + node.size.height);
  }
  const contentW = Math.max(1, maxX - minX);
  const contentH = Math.max(1, maxY - minY);
  const scale = clampScale(
    Math.min(
      (container.width - padding * 2) / contentW,
      (container.height - padding * 2) / contentH,
      1,
    ),
  );
  return {
    scale,
    x: (container.width - contentW * scale) / 2 - minX * scale,
    y: (container.height - contentH * scale) / 2 - minY * scale,
  };
}

/** Bezier path from a source anchor to a target point (world coords). */
export function connectionPath(
  from: { x: number; y: number },
  to: { x: number; y: number },
): string {
  const bend = Math.max(50, Math.abs(to.x - from.x) / 2);
  return `M ${from.x} ${from.y} C ${from.x + bend} ${from.y}, ${to.x - bend} ${to.y}, ${to.x} ${to.y}`;
}

function sourceAnchor(node: Pick<CanvasNode, "position" | "size">) {
  return {
    x: node.position.x + node.size.width,
    y: node.position.y + node.size.height / 2,
  };
}

function targetAnchor(node: Pick<CanvasNode, "position" | "size">) {
  return { x: node.position.x, y: node.position.y + node.size.height / 2 };
}

type DragState =
  | { kind: "pan"; startX: number; startY: number; origin: CanvasViewport }
  | {
      kind: "node";
      id: string;
      startX: number;
      startY: number;
      origin: { x: number; y: number };
    }
  | {
      kind: "resize";
      id: string;
      startX: number;
      startY: number;
      origin: { width: number; height: number };
    }
  | { kind: "connect"; fromId: string }
  | { kind: "marquee"; additive: boolean };

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable
  );
}

export function CanvasSurface({ className }: { className?: string }) {
  const {
    nodes,
    connections,
    viewport,
    selectedNodeIds,
    selectedConnectionId,
  } = useCanvas();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState(false);
  const [connectPoint, setConnectPoint] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [marquee, setMarquee] = useState<{
    start: { x: number; y: number };
    current: { x: number; y: number };
  } | null>(null);
  const selected = new Set(selectedNodeIds);

  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      const px = clientX - (rect?.left ?? 0);
      const py = clientY - (rect?.top ?? 0);
      return {
        x: (px - viewport.x) / viewport.scale,
        y: (py - viewport.y) / viewport.scale,
      };
    },
    [viewport],
  );

  // Wheel zoom: non-passive listener so preventDefault works.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const pointer = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      const factor = Math.exp(-event.deltaY * 0.0015);
      setViewport(zoomAtPoint(viewport, pointer, viewport.scale * factor));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [viewport]);

  // Keyboard shortcuts (active while the canvas is mounted; skipped when
  // typing into inputs/textareas so node editors keep native behavior).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (meta && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
      } else if (meta && event.key.toLowerCase() === "a") {
        event.preventDefault();
        selectAll();
      } else if (event.key === "Delete" || event.key === "Backspace") {
        deleteSelection();
      } else if (event.key === "Escape") {
        clearSelection();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const onPointerMove = useCallback(
    (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (drag.kind === "pan") {
        setViewport({
          ...drag.origin,
          x: drag.origin.x + (event.clientX - drag.startX),
          y: drag.origin.y + (event.clientY - drag.startY),
        });
      } else if (drag.kind === "node") {
        moveNode(drag.id, {
          x: drag.origin.x + (event.clientX - drag.startX) / viewport.scale,
          y: drag.origin.y + (event.clientY - drag.startY) / viewport.scale,
        });
      } else if (drag.kind === "resize") {
        resizeNode(drag.id, {
          width:
            drag.origin.width + (event.clientX - drag.startX) / viewport.scale,
          height:
            drag.origin.height + (event.clientY - drag.startY) / viewport.scale,
        });
      } else if (drag.kind === "connect") {
        setConnectPoint(toWorld(event.clientX, event.clientY));
      } else if (drag.kind === "marquee") {
        setMarquee((prev) =>
          prev
            ? { ...prev, current: toWorld(event.clientX, event.clientY) }
            : prev,
        );
      }
    },
    [viewport.scale, toWorld],
  );

  const onPointerUp = useCallback(
    (event: PointerEvent) => {
      const drag = dragRef.current;
      dragRef.current = null;
      setDragging(false);
      window.removeEventListener("pointermove", onPointerMove);
      if (!drag) return;

      if (drag.kind === "connect") {
        setConnectPoint(null);
        const point = toWorld(event.clientX, event.clientY);
        const target = [...nodes]
          .reverse()
          .find(
            (node) =>
              node.id !== drag.fromId &&
              point.x >= node.position.x &&
              point.x <= node.position.x + node.size.width &&
              point.y >= node.position.y &&
              point.y <= node.position.y + node.size.height,
          );
        if (target) {
          const created = connectNodes(drag.fromId, target.id);
          const source = nodes.find((node) => node.id === drag.fromId);
          if (created && source) {
            // Edges carry data: e.g. image → XHS editor feeds the post image.
            applyConnectionEffects(source, target);
          }
        }
      } else if (drag.kind === "marquee") {
        setMarquee((box) => {
          if (box) {
            const x1 = Math.min(box.start.x, box.current.x);
            const x2 = Math.max(box.start.x, box.current.x);
            const y1 = Math.min(box.start.y, box.current.y);
            const y2 = Math.max(box.start.y, box.current.y);
            const hit = nodes
              .filter(
                (node) =>
                  node.position.x < x2 &&
                  node.position.x + node.size.width > x1 &&
                  node.position.y < y2 &&
                  node.position.y + node.size.height > y1,
              )
              .map((node) => node.id);
            selectNodes(hit, drag.additive);
          }
          return null;
        });
      }
    },
    [nodes, onPointerMove, toWorld],
  );

  useEffect(() => {
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointermove", onPointerMove);
    };
  }, [onPointerUp, onPointerMove]);

  function beginDrag(state: DragState) {
    dragRef.current = state;
    setDragging(true);
    window.addEventListener("pointermove", onPointerMove);
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const connectSource =
    dragRef.current?.kind === "connect"
      ? nodeById.get(dragRef.current.fromId)
      : null;

  return (
    <div
      ref={containerRef}
      data-infinite-canvas="true"
      className={cn(
        "relative h-full w-full overflow-hidden",
        dragging ? "cursor-grabbing" : "cursor-grab",
        className,
      )}
      style={{
        backgroundImage:
          "radial-gradient(circle, var(--color-border) 1px, transparent 1px)",
        backgroundSize: `${24 * viewport.scale}px ${24 * viewport.scale}px`,
        backgroundPosition: `${viewport.x}px ${viewport.y}px`,
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        if (event.metaKey || event.ctrlKey) {
          const start = toWorld(event.clientX, event.clientY);
          setMarquee({ start, current: start });
          beginDrag({ kind: "marquee", additive: event.shiftKey });
          return;
        }
        clearSelection();
        beginDrag({
          kind: "pan",
          startX: event.clientX,
          startY: event.clientY,
          origin: viewport,
        });
      }}
    >
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
        }}
      >
        {/* Edges (world coordinates, under the nodes) */}
        <svg
          className="pointer-events-none absolute left-0 top-0 overflow-visible"
          width={1}
          height={1}
          aria-hidden="true"
        >
          {connections.map((connection) => {
            const from = nodeById.get(connection.fromNodeId);
            const to = nodeById.get(connection.toNodeId);
            if (!from || !to) return null;
            const isSelected = selectedConnectionId === connection.id;
            return (
              <path
                key={connection.id}
                data-canvas-edge={connection.id}
                d={connectionPath(sourceAnchor(from), targetAnchor(to))}
                fill="none"
                className={cn(
                  "pointer-events-auto cursor-pointer",
                  isSelected ? "stroke-sky-500" : "stroke-border",
                )}
                strokeWidth={isSelected ? 3 : 2}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  selectConnection(connection.id);
                }}
                onDoubleClick={() => removeConnection(connection.id)}
              />
            );
          })}
          {connectSource && connectPoint ? (
            <path
              d={connectionPath(sourceAnchor(connectSource), connectPoint)}
              fill="none"
              className="stroke-sky-500"
              strokeWidth={2}
              strokeDasharray="6 4"
            />
          ) : null}
        </svg>

        {/* Nodes */}
        {nodes.map((node) => (
          <div
            key={node.id}
            data-canvas-node={node.id}
            data-canvas-node-selected={selected.has(node.id) || undefined}
            className={cn(
              "absolute flex flex-col rounded-lg border bg-surface-1 shadow-lg shadow-black/5",
              selected.has(node.id) ? "border-sky-500" : "border-border",
            )}
            style={{
              left: node.position.x,
              top: node.position.y,
              width: node.size.width,
              height: node.size.height,
            }}
            onPointerDown={(event) => {
              event.stopPropagation();
              selectNodes([node.id], event.shiftKey);
            }}
          >
            <div
              className="flex shrink-0 cursor-move items-center justify-between gap-2 rounded-t-lg border-b border-border bg-surface-2/60 px-3 py-1.5"
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.stopPropagation();
                selectNodes([node.id], event.shiftKey);
                beginDrag({
                  kind: "node",
                  id: node.id,
                  startX: event.clientX,
                  startY: event.clientY,
                  origin: node.position,
                });
              }}
            >
              <span className="min-w-0 truncate text-xs font-medium text-text-secondary">
                {node.title}
              </span>
              <button
                type="button"
                aria-label="close node"
                onClick={() => removeNodes([node.id])}
                onPointerDown={(event) => event.stopPropagation()}
                className="shrink-0 rounded p-0.5 text-text-tertiary hover:bg-surface-3 hover:text-text-primary"
              >
                <X size={12} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              <NodeContent node={node} />
            </div>

            {/* Connect handle: drag from the right edge to another node */}
            <button
              type="button"
              aria-label="connect from node"
              data-canvas-connect-handle={node.id}
              className="absolute -right-2 top-1/2 h-4 w-4 -translate-y-1/2 cursor-crosshair rounded-full border-2 border-sky-500 bg-surface-1"
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.stopPropagation();
                setConnectPoint(toWorld(event.clientX, event.clientY));
                beginDrag({ kind: "connect", fromId: node.id });
              }}
            />
            {/* Resize handle (bottom-right corner) */}
            <div
              data-canvas-resize-handle={node.id}
              className="absolute -bottom-1 -right-1 h-3 w-3 cursor-nwse-resize rounded-sm border border-border bg-surface-2"
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.stopPropagation();
                beginDrag({
                  kind: "resize",
                  id: node.id,
                  startX: event.clientX,
                  startY: event.clientY,
                  origin: node.size,
                });
              }}
            />
          </div>
        ))}

        {/* Marquee rectangle */}
        {marquee ? (
          <div
            data-canvas-marquee="true"
            className="absolute border border-sky-500/70 bg-sky-500/10"
            style={{
              left: Math.min(marquee.start.x, marquee.current.x),
              top: Math.min(marquee.start.y, marquee.current.y),
              width: Math.abs(marquee.current.x - marquee.start.x),
              height: Math.abs(marquee.current.y - marquee.start.y),
            }}
          />
        ) : null}
      </div>

      <CanvasToolbar
        getContainerSize={() => ({
          width: containerRef.current?.clientWidth ?? 0,
          height: containerRef.current?.clientHeight ?? 0,
        })}
      />
    </div>
  );
}

// ── Node content by type ───────────────────────────────────────

function NodeContent({ node }: { node: CanvasNode }): ReactNode {
  if (node.type === "team-step") {
    return <TeamStepNodeContent node={node} />;
  }
  if (node.type === "video") {
    return node.metadata.content ? (
      // biome-ignore lint/a11y/useMediaCaption: user-provided clips have no captions
      <video
        src={node.metadata.content}
        controls
        className="h-full w-full rounded object-contain"
      />
    ) : (
      <p className="text-xs text-text-tertiary">
        通过底部工具栏「上传」放入视频。
      </p>
    );
  }
  if (node.type === "audio") {
    return node.metadata.content ? (
      // biome-ignore lint/a11y/useMediaCaption: user-provided clips have no captions
      <audio src={node.metadata.content} controls className="w-full" />
    ) : (
      <p className="text-xs text-text-tertiary">
        通过底部工具栏「上传」放入音频。
      </p>
    );
  }
  if (node.type === "a2ui") {
    const payload = node.metadata.surfaceId
      ? getA2UIPayload(node.metadata.surfaceId)
      : null;
    if (!payload) {
      return (
        <p className="text-xs text-text-tertiary">
          内容已过期 — 从原入口（运行卡/编辑器）重新打开即可恢复。
        </p>
      );
    }
    return (
      <A2UIRenderer messages={payload.messages} onAction={payload.onAction} />
    );
  }
  if (node.type === "text") {
    return (
      <textarea
        className="h-full w-full resize-none bg-transparent text-sm outline-none"
        style={{ fontSize: node.metadata.fontSize ?? 14 }}
        placeholder="输入文本…"
        value={node.metadata.content ?? ""}
        onChange={(event) =>
          updateNode(node.id, { metadata: { content: event.target.value } })
        }
      />
    );
  }
  // image
  if (node.metadata.content) {
    return (
      <img
        src={node.metadata.content}
        alt={node.title}
        className="h-full w-full rounded object-contain"
        draggable={false}
      />
    );
  }
  return (
    <label className="flex h-full w-full cursor-pointer flex-col items-center justify-center gap-2 rounded border border-dashed border-border text-xs text-text-tertiary hover:bg-surface-2/50">
      <ImagePlus size={20} />
      选择图片
      <input
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            updateNode(node.id, {
              title: file.name,
              metadata: { content: String(reader.result) },
            });
          };
          reader.readAsDataURL(file);
        }}
      />
    </label>
  );
}

// ── Toolbar ────────────────────────────────────────────────────

function CanvasToolbar({
  getContainerSize,
}: {
  getContainerSize: () => { width: number; height: number };
}) {
  const { nodes, viewport, selectedNodeIds, selectedConnectionId } =
    useCanvas();
  const hasSelection = selectedNodeIds.length > 0 || !!selectedConnectionId;

  return (
    <div
      data-canvas-toolbar="true"
      className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-border bg-surface-1/95 px-2 py-1 shadow-md"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <ToolButton label="撤销" onClick={undo}>
        <Undo2 size={14} />
      </ToolButton>
      <ToolButton label="重做" onClick={redo}>
        <Redo2 size={14} />
      </ToolButton>
      <Divider />
      <ToolButton
        label="文本节点"
        onClick={() => addNode({ type: "text", title: "文本" })}
      >
        <Type size={14} />
      </ToolButton>
      <ToolButton
        label="图片节点"
        onClick={() => addNode({ type: "image", title: "图片" })}
      >
        <ImagePlus size={14} />
      </ToolButton>
      <ToolButton
        label="视频节点"
        onClick={() => addNode({ type: "video", title: "视频" })}
      >
        <Clapperboard size={14} />
      </ToolButton>
      <ToolButton
        label="音频节点"
        onClick={() => addNode({ type: "audio", title: "音频" })}
      >
        <AudioLines size={14} />
      </ToolButton>
      <label
        title="上传素材"
        className="cursor-pointer rounded p-1.5 text-text-secondary hover:bg-surface-2 hover:text-text-primary"
      >
        <Upload size={14} />
        <input
          type="file"
          multiple
          accept="image/*,video/*,audio/*"
          className="hidden"
          onChange={(event) => {
            for (const file of Array.from(event.target.files ?? [])) {
              const reader = new FileReader();
              const kind = file.type.startsWith("video/")
                ? ("video" as const)
                : file.type.startsWith("audio/")
                  ? ("audio" as const)
                  : ("image" as const);
              reader.onload = () => {
                addNode({
                  type: kind,
                  title: file.name,
                  metadata: {
                    content: String(reader.result),
                    mimeType: file.type,
                  },
                });
              };
              reader.readAsDataURL(file);
            }
            event.target.value = "";
          }}
        />
      </label>
      <Divider />
      {hasSelection ? (
        <>
          <ToolButton label="删除选中" onClick={deleteSelection}>
            <Trash2 size={14} className="text-danger" />
          </ToolButton>
          <Divider />
        </>
      ) : null}
      <ToolButton
        label="适配全部"
        onClick={() => setViewport(fitViewport(nodes, getContainerSize()))}
      >
        <Maximize2 size={14} />
      </ToolButton>
      <span className="px-1 text-[10px] tabular-nums text-text-tertiary">
        {Math.round(viewport.scale * 100)}%
      </span>
      <Divider />
      <button
        type="button"
        onClick={() => {
          if (nodes.length === 0 || window.confirm("清空画布上的全部节点？")) {
            clearCanvas();
          }
        }}
        className="rounded px-1.5 py-1 text-[10px] text-text-tertiary hover:bg-surface-2 hover:text-danger"
      >
        清空
      </button>
    </div>
  );
}

function ToolButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="rounded p-1.5 text-text-secondary hover:bg-surface-2 hover:text-text-primary"
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="mx-0.5 h-4 w-px bg-border" />;
}
