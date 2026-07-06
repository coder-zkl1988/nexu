import { A2UIRenderer } from "@/lib/a2ui";
import { cn } from "@/lib/utils";
import {
  AudioLines,
  Clapperboard,
  Download,
  ImagePlus,
  Lock,
  Maximize2,
  Redo2,
  Trash2,
  Type,
  Undo2,
  Unlock,
  Upload,
  X,
} from "lucide-react";
import {
  type ReactNode,
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  clipboardHasContent,
  copySelection,
  duplicateNodes,
  pasteClipboard,
} from "./canvas-clipboard";
import { createConnectedNode } from "./canvas-create";
import { FloatingMenu, clampMenuPosition } from "./canvas-floating-menu";
import { generateImageIntoNode, retryNodeTask } from "./canvas-generation";
import { type ResizeCorner, computeResizeGeometry } from "./canvas-geometry";
import {
  ingestFilesAsNodes,
  ingestTextAsNode,
  readFilesAsDataUrls,
} from "./canvas-ingest";
import {
  type CanvasExportFile,
  type CanvasNode,
  type CanvasViewport,
  addNode,
  clearCanvas,
  clearSelection,
  connectNodes,
  deleteSelection,
  exportCanvas,
  getA2UIPayload,
  getCanvasState,
  hydrateCanvasFromStorage,
  importCanvas,
  moveNodes,
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
 *
 * Interaction core (reference paradigm):
 * - the container opts out of text selection permanently (`select-none`);
 *   gesture starts call preventDefault + setPointerCapture, and editors
 *   inside nodes opt back in with `select-text` / native form controls.
 * - window pointer listeners are registered ONCE and read live state via
 *   getCanvasState() — no identity churn mid-gesture.
 * - pointermove is coalesced through requestAnimationFrame: at most one
 *   store commit per frame.
 * - nodes are positioned with transform + `contain: layout style` and
 *   rendered through React.memo; node content additionally ignores
 *   geometry-only changes, so dragging never re-renders A2UI trees.
 */

export const CANVAS_MIN_SCALE = 0.05;
export const CANVAS_MAX_SCALE = 5;

export function clampScale(scale: number): number {
  return Math.min(CANVAS_MAX_SCALE, Math.max(CANVAS_MIN_SCALE, scale));
}

/**
 * Compute the grid background-size in pixels at the given scale.
 * Returns null when the dots would be < 4px apart (visual noise at high zoom-out).
 */
export function gridBackgroundSize(scale: number): number | null {
  const size = 24 * scale;
  return size < 4 ? null : size;
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

type GestureState =
  | { kind: "pan"; startX: number; startY: number; origin: CanvasViewport }
  | {
      kind: "node";
      startX: number;
      startY: number;
      origins: Array<{ id: string; x: number; y: number }>;
    }
  | {
      kind: "resize";
      id: string;
      corner: ResizeCorner;
      startX: number;
      startY: number;
      origin: { x: number; y: number; width: number; height: number };
      lockRatio: boolean;
    }
  | { kind: "connect"; fromId: string }
  | { kind: "marquee"; additive: boolean };

type ContextMenuState =
  | { kind: "node"; id: string; x: number; y: number }
  | { kind: "edge"; id: string; x: number; y: number }
  | {
      kind: "background";
      x: number;
      y: number;
      worldPoint: { x: number; y: number };
    };

type ConnectMenuState = {
  fromId: string;
  screenX: number;
  screenY: number;
  worldX: number;
  worldY: number;
};

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
  const gestureRef = useRef<GestureState | null>(null);
  const pointerRef = useRef({ x: 0, y: 0 });
  const rafRef = useRef<number | null>(null);
  const marqueeRef = useRef<{
    start: { x: number; y: number };
    current: { x: number; y: number };
  } | null>(null);
  const [gestureActive, setGestureActive] = useState(false);
  const [connectPreview, setConnectPreview] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [marqueeBox, setMarqueeBox] = useState<{
    start: { x: number; y: number };
    current: { x: number; y: number };
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [connectMenu, setConnectMenu] = useState<ConnectMenuState | null>(null);
  const spaceRef = useRef(false);
  const selected = new Set(selectedNodeIds);

  // Hydrate canvas content from IndexedDB on mount (once).
  useEffect(() => {
    void hydrateCanvasFromStorage();
  }, []);

  // Stable: reads the live viewport from the store, never from a closure.
  const toWorld = useCallback((clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    const live = getCanvasState().viewport;
    const px = clientX - (rect?.left ?? 0);
    const py = clientY - (rect?.top ?? 0);
    return {
      x: (px - live.x) / live.scale,
      y: (py - live.y) / live.scale,
    };
  }, []);

  /** Apply the latest pointer position for `gesture` (≤ once per frame). */
  const applyGesture = useCallback(
    (gesture: GestureState) => {
      const { x: clientX, y: clientY } = pointerRef.current;
      if (gesture.kind === "pan") {
        setViewport({
          scale: gesture.origin.scale,
          x: gesture.origin.x + (clientX - gesture.startX),
          y: gesture.origin.y + (clientY - gesture.startY),
        });
      } else if (gesture.kind === "node") {
        const scale = getCanvasState().viewport.scale;
        const dx = (clientX - gesture.startX) / scale;
        const dy = (clientY - gesture.startY) / scale;
        moveNodes(
          gesture.origins.map((origin) => ({
            id: origin.id,
            position: { x: origin.x + dx, y: origin.y + dy },
          })),
        );
      } else if (gesture.kind === "resize") {
        const scale = getCanvasState().viewport.scale;
        const dx = (clientX - gesture.startX) / scale;
        const dy = (clientY - gesture.startY) / scale;
        const result = computeResizeGeometry({
          corner: gesture.corner,
          origin: gesture.origin,
          dx,
          dy,
          lockRatio: gesture.lockRatio,
        });
        resizeNode(
          gesture.id,
          { width: result.width, height: result.height },
          { x: result.x, y: result.y },
        );
      } else if (gesture.kind === "connect") {
        setConnectPreview(toWorld(clientX, clientY));
      } else if (gesture.kind === "marquee") {
        const box = marqueeRef.current;
        if (box) {
          const next = { ...box, current: toWorld(clientX, clientY) };
          marqueeRef.current = next;
          setMarqueeBox(next);
        }
      }
    },
    [toWorld],
  );

  // Window listeners live for the component lifetime; gestures are pure ref
  // state, so identities never churn mid-drag (a viewport-dependent handler
  // here previously lost the pan listener after the first frame).
  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      if (!gestureRef.current) return;
      pointerRef.current = { x: event.clientX, y: event.clientY };
      if (rafRef.current == null) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          if (gestureRef.current) applyGesture(gestureRef.current);
        });
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      const gesture = gestureRef.current;
      if (!gesture) return;
      gestureRef.current = null;
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      setGestureActive(false);
      pointerRef.current = { x: event.clientX, y: event.clientY };

      if (gesture.kind === "node" || gesture.kind === "resize") {
        // Commit the exact release position (a pending frame may be stale).
        applyGesture(gesture);
        return;
      }
      if (gesture.kind === "connect") {
        setConnectPreview(null);
        const point = toWorld(event.clientX, event.clientY);
        const liveNodes = getCanvasState().nodes;
        const target = [...liveNodes]
          .reverse()
          .find(
            (node) =>
              node.id !== gesture.fromId &&
              point.x >= node.position.x &&
              point.x <= node.position.x + node.size.width &&
              point.y >= node.position.y &&
              point.y <= node.position.y + node.size.height,
          );
        if (target) {
          const created = connectNodes(gesture.fromId, target.id);
          const source = liveNodes.find((node) => node.id === gesture.fromId);
          if (created && source) {
            // Edges carry data: e.g. image → XHS editor feeds the post image.
            applyConnectionEffects(source, target);
          }
        } else {
          // No target node hit — open the create-node menu at the drop point.
          const rect = containerRef.current?.getBoundingClientRect();
          const cw = rect?.width ?? 0;
          const ch = rect?.height ?? 0;
          const rawX = event.clientX - (rect?.left ?? 0);
          const rawY = event.clientY - (rect?.top ?? 0);
          // Connect menu is ~160px wide, use shared clamp with explicit override.
          const { x: screenX, y: screenY } = clampMenuPosition(
            rawX,
            rawY,
            cw,
            ch,
            160,
            170,
          );
          setConnectMenu({
            fromId: gesture.fromId,
            screenX,
            screenY,
            worldX: point.x,
            worldY: point.y,
          });
        }
        return;
      }
      if (gesture.kind === "marquee") {
        const box = marqueeRef.current;
        marqueeRef.current = null;
        setMarqueeBox(null);
        if (box) {
          const x1 = Math.min(box.start.x, box.current.x);
          const x2 = Math.max(box.start.x, box.current.x);
          const y1 = Math.min(box.start.y, box.current.y);
          const y2 = Math.max(box.start.y, box.current.y);
          const hit = getCanvasState()
            .nodes.filter(
              (node) =>
                node.position.x < x2 &&
                node.position.x + node.size.width > x1 &&
                node.position.y < y2 &&
                node.position.y + node.size.height > y1,
            )
            .map((node) => node.id);
          selectNodes(hit, gesture.additive);
        }
      }
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [applyGesture, toWorld]);

  /** Close floating menus (context and connect). */
  const closeFloatingMenus = useCallback(() => {
    setContextMenu(null);
    setConnectMenu(null);
  }, []);

  /** Start a gesture: kill text selection/native drag, capture the pointer. */
  const beginGesture = useCallback(
    (event: React.PointerEvent, gesture: GestureState) => {
      event.preventDefault();
      try {
        (event.currentTarget as Element).setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is best-effort (absent in some test DOMs).
      }
      pointerRef.current = { x: event.clientX, y: event.clientY };
      gestureRef.current = gesture;
      setGestureActive(true);
      closeFloatingMenus();
    },
    [closeFloatingMenus],
  );

  const beginNodeDrag = useCallback(
    (event: React.PointerEvent, nodeId: string) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      const state = getCanvasState();
      // Dragging a node inside the current selection moves the whole
      // selection; otherwise selection collapses to the grabbed node.
      if (!state.selectedNodeIds.includes(nodeId)) {
        selectNodes([nodeId], event.shiftKey);
      }
      const after = getCanvasState();
      const origins = after.nodes
        .filter((node) => after.selectedNodeIds.includes(node.id))
        .map((node) => ({
          id: node.id,
          x: node.position.x,
          y: node.position.y,
        }));
      beginGesture(event, {
        kind: "node",
        startX: event.clientX,
        startY: event.clientY,
        origins,
      });
    },
    [beginGesture],
  );

  const beginResize = useCallback(
    (event: React.PointerEvent, nodeId: string, corner: ResizeCorner) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      const node = getCanvasState().nodes.find((n) => n.id === nodeId);
      if (!node) return;
      const lockRatio =
        (node.type === "image" || node.type === "video") &&
        Boolean(node.metadata.content) &&
        node.metadata.freeResize !== true;
      beginGesture(event, {
        kind: "resize",
        id: nodeId,
        corner,
        startX: event.clientX,
        startY: event.clientY,
        origin: {
          x: node.position.x,
          y: node.position.y,
          width: node.size.width,
          height: node.size.height,
        },
        lockRatio,
      });
    },
    [beginGesture],
  );

  const beginConnect = useCallback(
    (event: React.PointerEvent, nodeId: string) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      setConnectPreview(toWorld(event.clientX, event.clientY));
      beginGesture(event, { kind: "connect", fromId: nodeId });
    },
    [beginGesture, toWorld],
  );

  // Wheel zoom: non-passive listener registered once; reads live viewport.
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
      const live = getCanvasState().viewport;
      const factor = Math.exp(-event.deltaY * 0.0015);
      setViewport(zoomAtPoint(live, pointer, live.scale * factor));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Keyboard shortcuts + paste (active while the canvas is mounted; skipped
  // when typing into inputs/textareas so node editors keep native behavior).
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
      } else if (meta && event.key.toLowerCase() === "c") {
        const copied = copySelection();
        if (copied >= 1) event.preventDefault();
      } else if (event.key === "Delete" || event.key === "Backspace") {
        deleteSelection();
      } else if (event.key === "Escape") {
        clearSelection();
        closeFloatingMenus();
      }
    };

    const onPaste = (event: ClipboardEvent) => {
      if (isEditableTarget(event.target)) return;

      const data = event.clipboardData;
      if (!data) return;

      // Center of the current view in world coordinates.
      const rect = containerRef.current?.getBoundingClientRect();
      const centerClient = {
        x: (rect?.left ?? 0) + (rect?.width ?? 0) / 2,
        y: (rect?.top ?? 0) + (rect?.height ?? 0) / 2,
      };
      const centerWorld = toWorld(centerClient.x, centerClient.y);

      // Precedence:
      // 1. OS file items with image/* type → ingest as image nodes (screenshot Cmd+V).
      // 2. Internal node clipboard → paste copied nodes.
      // 3. OS plain text → ingest as text node.
      const imageFiles: File[] = [];
      for (const item of Array.from(data.items)) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }

      if (imageFiles.length > 0) {
        event.preventDefault();
        void readFilesAsDataUrls(imageFiles).then((inputs) => {
          ingestFilesAsNodes(inputs, centerWorld);
        });
        return;
      }

      if (clipboardHasContent()) {
        event.preventDefault();
        pasteClipboard();
        return;
      }

      const text = data.getData("text/plain");
      if (text) {
        event.preventDefault();
        ingestTextAsNode(text, centerWorld);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("paste", onPaste);
    };
  }, [toWorld, closeFloatingMenus]);

  // Space-key pan mode: track via ref for capture-phase handler (zero re-render cost).
  // DOM attribute on the container drives cursor feedback via a CSS rule in index.css.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      if (isEditableTarget(event.target)) return;
      if (event.repeat) return;
      event.preventDefault(); // prevent scrollable ancestors from scrolling
      spaceRef.current = true;
      containerRef.current?.setAttribute("data-space-pan", "true");
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      spaceRef.current = false;
      containerRef.current?.removeAttribute("data-space-pan");
    };
    const onBlur = () => {
      spaceRef.current = false;
      containerRef.current?.removeAttribute("data-space-pan");
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const connectSource =
    gestureRef.current?.kind === "connect"
      ? nodeById.get(gestureRef.current.fromId)
      : null;
  const gridSize = gridBackgroundSize(viewport.scale);

  return (
    <div
      ref={containerRef}
      data-infinite-canvas="true"
      className={cn(
        "relative h-full w-full select-none overflow-hidden",
        gestureActive ? "cursor-grabbing" : "cursor-grab",
        className,
      )}
      style={
        gridSize !== null
          ? {
              backgroundImage:
                "radial-gradient(circle, var(--color-border) 1px, transparent 1px)",
              backgroundSize: `${gridSize}px ${gridSize}px`,
              backgroundPosition: `${viewport.x % gridSize}px ${viewport.y % gridSize}px`,
            }
          : undefined
      }
      onPointerDownCapture={(event) => {
        // Space+left or middle-click: begin pan from anywhere (including over nodes).
        // beginGesture calls closeFloatingMenus() — no need to do it explicitly here.
        if ((spaceRef.current && event.button === 0) || event.button === 1) {
          event.preventDefault();
          event.stopPropagation();
          beginGesture(event, {
            kind: "pan",
            startX: event.clientX,
            startY: event.clientY,
            origin: getCanvasState().viewport,
          });
        }
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (files.length === 0) return;
        const dropWorld = toWorld(event.clientX, event.clientY);
        void readFilesAsDataUrls(files).then((inputs) => {
          ingestFilesAsNodes(inputs, dropWorld);
        });
      }}
      onContextMenu={(event) => {
        // Right-click inside a node textarea/input must not open the canvas menu.
        if (isEditableTarget(event.target)) return;
        event.preventDefault();
        const rect = containerRef.current?.getBoundingClientRect();
        const cw = rect?.width ?? 0;
        const ch = rect?.height ?? 0;
        const rawX = event.clientX - (rect?.left ?? 0);
        const rawY = event.clientY - (rect?.top ?? 0);
        const { x: screenX, y: screenY } = clampMenuPosition(
          rawX,
          rawY,
          cw,
          ch,
        );
        const target = event.target as Element | null;
        const nodeEl = target?.closest("[data-canvas-node]");
        const edgeEl = target?.closest("[data-canvas-edge]");
        if (nodeEl instanceof HTMLElement) {
          const id = nodeEl.getAttribute("data-canvas-node") ?? "";
          // Select the node if it's not already selected
          if (!getCanvasState().selectedNodeIds.includes(id)) {
            selectNodes([id]);
          }
          setContextMenu({ kind: "node", id, x: screenX, y: screenY });
        } else if (edgeEl) {
          const id = edgeEl.getAttribute("data-canvas-edge") ?? "";
          setContextMenu({ kind: "edge", id, x: screenX, y: screenY });
        } else {
          const worldPoint = toWorld(event.clientX, event.clientY);
          setContextMenu({
            kind: "background",
            x: screenX,
            y: screenY,
            worldPoint,
          });
        }
      }}
      onPointerDown={(event) => {
        // Close floating menus on any pointerdown on the container background.
        // For left-click paths, beginGesture also calls closeFloatingMenus; this
        // covers non-left-click (e.g. right-click while the menu is open).
        closeFloatingMenus();
        if (event.button !== 0) return;
        if (event.metaKey || event.ctrlKey) {
          const start = toWorld(event.clientX, event.clientY);
          marqueeRef.current = { start, current: start };
          setMarqueeBox(marqueeRef.current);
          beginGesture(event, { kind: "marquee", additive: event.shiftKey });
          return;
        }
        clearSelection();
        beginGesture(event, {
          kind: "pan",
          startX: event.clientX,
          startY: event.clientY,
          origin: getCanvasState().viewport,
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
          {connectSource && connectPreview ? (
            <path
              d={connectionPath(sourceAnchor(connectSource), connectPreview)}
              fill="none"
              className="stroke-sky-500"
              strokeWidth={2}
              strokeDasharray="6 4"
            />
          ) : null}
        </svg>

        {/* Nodes */}
        {nodes.map((node) => (
          <CanvasNodeView
            key={node.id}
            node={node}
            selected={selected.has(node.id)}
            onHeaderDown={beginNodeDrag}
            onResizeDown={beginResize}
            onConnectDown={beginConnect}
          />
        ))}

        {/* Marquee rectangle */}
        {marqueeBox ? (
          <div
            data-canvas-marquee="true"
            className="absolute border border-sky-500/70 bg-sky-500/10"
            style={{
              left: Math.min(marqueeBox.start.x, marqueeBox.current.x),
              top: Math.min(marqueeBox.start.y, marqueeBox.current.y),
              width: Math.abs(marqueeBox.current.x - marqueeBox.start.x),
              height: Math.abs(marqueeBox.current.y - marqueeBox.start.y),
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

      {/* Context menu — screen-space, outside the transform layer */}
      {contextMenu ? (
        <FloatingMenu
          x={contextMenu.x}
          y={contextMenu.y}
          dataAttr={{ name: "data-canvas-context-menu", value: "true" }}
        >
          {contextMenu.kind === "node" ? (
            <>
              <ContextMenuItem
                label="复制为副本"
                onClick={() => {
                  duplicateNodes([contextMenu.id]);
                  setContextMenu(null);
                }}
              />
              <ContextMenuItem
                label="删除"
                onClick={() => {
                  removeNodes([contextMenu.id]);
                  setContextMenu(null);
                }}
              />
            </>
          ) : contextMenu.kind === "edge" ? (
            <ContextMenuItem
              label="删除连线"
              onClick={() => {
                removeConnection(contextMenu.id);
                setContextMenu(null);
              }}
            />
          ) : (
            <ContextMenuItem
              label="粘贴到此处"
              disabled={!clipboardHasContent()}
              onClick={() => {
                if (!clipboardHasContent()) return;
                pasteClipboard(contextMenu.worldPoint);
                setContextMenu(null);
              }}
            />
          )}
        </FloatingMenu>
      ) : null}

      {/* Connect menu — screen-space, outside the transform layer */}
      {connectMenu ? (
        <FloatingMenu
          x={connectMenu.screenX}
          y={connectMenu.screenY}
          dataAttr={{ name: "data-canvas-connect-menu", value: "true" }}
        >
          {(
            [
              { type: "text", icon: <Type size={14} />, label: "文本" },
              { type: "image", icon: <ImagePlus size={14} />, label: "图片" },
              {
                type: "video",
                icon: <Clapperboard size={14} />,
                label: "视频",
              },
              {
                type: "audio",
                icon: <AudioLines size={14} />,
                label: "音频",
              },
            ] as const
          ).map(({ type, icon, label }) => (
            <button
              key={type}
              type="button"
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-text-primary hover:bg-surface-2"
              onClick={() => {
                createConnectedNode(connectMenu.fromId, type, {
                  x: connectMenu.worldX,
                  y: connectMenu.worldY,
                });
                setConnectMenu(null);
              }}
            >
              {icon}
              {label}
            </button>
          ))}
        </FloatingMenu>
      ) : null}
    </div>
  );
}

// ── Node view (memoized frame + geometry-insensitive body) ─────

type NodeGestureHandler = (event: React.PointerEvent, nodeId: string) => void;
type ResizeGestureHandler = (
  event: React.PointerEvent,
  nodeId: string,
  corner: ResizeCorner,
) => void;

const CanvasNodeView = memo(function CanvasNodeView({
  node,
  selected,
  onHeaderDown,
  onResizeDown,
  onConnectDown,
}: {
  node: CanvasNode;
  selected: boolean;
  onHeaderDown: NodeGestureHandler;
  onResizeDown: ResizeGestureHandler;
  onConnectDown: NodeGestureHandler;
}) {
  // Media with content renders full-bleed like the reference cards.
  const fullBleed =
    (node.type === "image" || node.type === "video") &&
    Boolean(node.metadata.content);
  return (
    <div
      data-canvas-node={node.id}
      data-canvas-node-selected={selected || undefined}
      className={cn(
        "group absolute flex flex-col rounded-2xl border-2 bg-surface-1 transition-shadow duration-200",
        selected
          ? "z-50 border-sky-500 shadow-xl shadow-sky-500/10"
          : "z-10 border-border shadow-lg shadow-black/5",
      )}
      style={{
        transform: `translate3d(${node.position.x}px, ${node.position.y}px, 0)`,
        width: node.size.width,
        height: node.size.height,
        contain: "layout style",
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
        if (!getCanvasState().selectedNodeIds.includes(node.id)) {
          selectNodes([node.id], event.shiftKey);
        }
      }}
    >
      <div
        className="flex shrink-0 cursor-move items-center justify-between gap-2 rounded-t-[14px] border-b border-border bg-surface-2/60 px-3 py-1.5"
        onPointerDown={(event) => onHeaderDown(event, node.id)}
      >
        <span className="min-w-0 truncate text-xs font-medium text-text-secondary">
          {node.title}
        </span>
        <div className="flex shrink-0 items-center gap-0.5">
          {(node.type === "image" || node.type === "video") &&
          Boolean(node.metadata.content) ? (
            <button
              type="button"
              aria-label="toggle aspect ratio lock"
              data-canvas-lock-toggle={node.id}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() =>
                updateNode(node.id, {
                  metadata: { freeResize: !node.metadata.freeResize },
                })
              }
              className="rounded p-0.5 text-text-tertiary hover:bg-surface-3 hover:text-text-primary"
            >
              {node.metadata.freeResize ? (
                <Unlock size={12} />
              ) : (
                <Lock size={12} />
              )}
            </button>
          ) : null}
          <button
            type="button"
            aria-label="close node"
            onClick={() => removeNodes([node.id])}
            onPointerDown={(event) => event.stopPropagation()}
            className="rounded p-0.5 text-text-tertiary hover:bg-surface-3 hover:text-text-primary"
          >
            <X size={12} />
          </button>
        </div>
      </div>
      <div
        className={cn(
          "min-h-0 flex-1",
          fullBleed
            ? "overflow-hidden rounded-b-[14px]"
            : "overflow-y-auto p-3",
        )}
      >
        <NodeBody node={node} />
      </div>

      {/* Connect handle: 48px hit zone with a 12px dot, shown on
          hover/selection (reference paradigm), drag to another node. */}
      <button
        type="button"
        aria-label="connect from node"
        data-canvas-connect-handle={node.id}
        className={cn(
          "absolute -right-6 top-1/2 z-30 flex size-12 -translate-y-1/2 cursor-crosshair items-center justify-center transition-opacity duration-150",
          selected
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100",
        )}
        onPointerDown={(event) => onConnectDown(event, node.id)}
      >
        <span className="size-3 rounded-full border-2 border-sky-500 bg-surface-1 transition-transform hover:scale-125" />
      </button>
      {/* Resize: four invisible 28px corner zones (cursor is the affordance). */}
      <div
        data-canvas-resize-handle={node.id}
        data-resize-corner="nw"
        className="absolute -left-3.5 -top-3.5 z-40 size-7 cursor-nwse-resize"
        onPointerDown={(event) => onResizeDown(event, node.id, "nw")}
      />
      <div
        data-canvas-resize-handle={node.id}
        data-resize-corner="ne"
        className="absolute -right-3.5 -top-3.5 z-40 size-7 cursor-nesw-resize"
        onPointerDown={(event) => onResizeDown(event, node.id, "ne")}
      />
      <div
        data-canvas-resize-handle={node.id}
        data-resize-corner="sw"
        className="absolute -bottom-3.5 -left-3.5 z-40 size-7 cursor-nesw-resize"
        onPointerDown={(event) => onResizeDown(event, node.id, "sw")}
      />
      <div
        data-canvas-resize-handle={node.id}
        data-resize-corner="se"
        className="absolute -bottom-3.5 -right-3.5 z-40 size-7 cursor-nwse-resize"
        onPointerDown={(event) => onResizeDown(event, node.id, "se")}
      />
    </div>
  );
});

/** Node content re-renders only on content changes, never on geometry. */
const NodeBody = memo(
  function NodeBody({ node }: { node: CanvasNode }) {
    return <NodeContent node={node} />;
  },
  (prev, next) =>
    prev.node.id === next.node.id &&
    prev.node.type === next.node.type &&
    prev.node.title === next.node.title &&
    prev.node.metadata === next.node.metadata,
);

// ── Node content by type ───────────────────────────────────────

function EmptyMediaHint({
  icon,
  label,
}: {
  icon: ReactNode;
  label: string;
}) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-text-tertiary">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-surface-2">
        <span className="opacity-40">{icon}</span>
      </div>
      <span className="text-[10px] tracking-[0.18em] opacity-70">{label}</span>
    </div>
  );
}

function NodeContent({ node }: { node: CanvasNode }): ReactNode {
  if (node.type === "team-step") {
    return <TeamStepNodeContent node={node} />;
  }

  // Task status overlay: applies before per-type media rendering for image/video/audio.
  if (node.metadata.task?.status === "generating") {
    return (
      <div
        data-canvas-node-generating={node.id}
        className="flex h-full w-full flex-col items-center justify-center gap-3"
      >
        <div className="size-10 animate-spin rounded-full border-2 border-border border-t-sky-500" />
        <span className="text-[11px] tracking-[0.18em] text-text-tertiary">
          生成中
        </span>
      </div>
    );
  }
  if (node.metadata.task?.status === "error") {
    return (
      <div
        data-canvas-node-error={node.id}
        className="flex h-full w-full flex-col items-center justify-center gap-2"
      >
        <p className="text-[11px] text-danger">
          {node.metadata.task.error ?? "生成失败，请重试"}
        </p>
        <button
          type="button"
          data-canvas-node-retry={node.id}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => retryNodeTask(node.id)}
          className="rounded-full border border-border px-3 py-1 text-[11px] text-text-secondary hover:bg-surface-2"
        >
          重试
        </button>
      </div>
    );
  }

  if (node.type === "video") {
    return node.metadata.content ? (
      // biome-ignore lint/a11y/useMediaCaption: user-provided clips have no captions
      <video
        src={node.metadata.content}
        controls
        className="h-full w-full bg-black object-contain"
      />
    ) : (
      <EmptyMediaHint icon={<Clapperboard size={22} />} label="空视频节点" />
    );
  }
  if (node.type === "audio") {
    return node.metadata.content ? (
      <div className="flex h-full w-full flex-col justify-center">
        {/* biome-ignore lint/a11y/useMediaCaption: user-provided clips have no captions */}
        <audio src={node.metadata.content} controls className="w-full" />
      </div>
    ) : (
      <EmptyMediaHint icon={<AudioLines size={22} />} label="空音频节点" />
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
        className="h-full w-full select-text resize-none bg-transparent text-sm outline-none"
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
        className="pointer-events-none h-full w-full select-none object-contain"
        draggable={false}
      />
    );
  }
  return <EmptyImageNode node={node} />;
}

/**
 * Empty image node: upload a file OR generate one from a prompt via the S7
 * controller channel (POST /api/v1/media/generate-image).
 *
 * Generating/error state lives in node.metadata.task (store-level); this
 * component holds only the local prompt input state.
 */
function EmptyImageNode({ node }: { node: CanvasNode }) {
  const [prompt, setPrompt] = useState("");
  const isGenerating = node.metadata.task?.status === "generating";

  return (
    <div className="flex h-full w-full flex-col gap-2">
      <label className="flex flex-1 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border text-xs text-text-tertiary hover:bg-surface-2/50">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-surface-2">
          <ImagePlus size={22} className="opacity-40" />
        </div>
        <span className="text-[10px] tracking-[0.18em] opacity-70">
          上传或在下方生成
        </span>
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
      <div className="flex shrink-0 items-center gap-1">
        <input
          value={prompt}
          disabled={isGenerating}
          placeholder="描述要生成的图片…"
          onChange={(event) => setPrompt(event.target.value)}
          className="min-w-0 flex-1 rounded border border-border bg-transparent px-2 py-1 text-xs outline-none"
        />
        <button
          type="button"
          disabled={isGenerating || !prompt.trim()}
          data-canvas-generate-image={node.id}
          onClick={() => {
            void generateImageIntoNode(node.id, prompt.trim());
          }}
          className="shrink-0 rounded border border-[var(--color-accent)] bg-[var(--color-accent)] px-2 py-1 text-xs font-bold text-[var(--color-accent-fg)] hover:opacity-90 disabled:opacity-50"
        >
          生成
        </button>
      </div>
    </div>
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
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            if (files.length === 0) return;
            // Place at top-left cascade; ingestFilesAsNodes handles MIME detection.
            void readFilesAsDataUrls(files).then((inputs) => {
              ingestFilesAsNodes(inputs, { x: 32, y: 32 });
            });
          }}
        />
      </label>
      <ToolButton
        label="导出画布"
        onClick={() => {
          const file = exportCanvas();
          const json = JSON.stringify(file, null, 2);
          const blob = new Blob([json], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const now = new Date();
          const pad = (n: number) => String(n).padStart(2, "0");
          const filename = `nexu-canvas-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.json`;
          const a = document.createElement("a");
          a.href = url;
          a.download = filename;
          a.click();
          URL.revokeObjectURL(url);
        }}
      >
        <Download size={14} />
      </ToolButton>
      <label
        title="导入画布"
        className="cursor-pointer rounded p-1.5 text-text-secondary hover:bg-surface-2 hover:text-text-primary"
      >
        <Upload size={14} />
        <input
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
              try {
                const parsed = JSON.parse(
                  String(reader.result),
                ) as CanvasExportFile;
                importCanvas(parsed);
              } catch {
                toast.error("导入失败：不是有效的画布文件");
              }
              event.target.value = "";
            };
            reader.onerror = () => {
              toast.error("导入失败：不是有效的画布文件");
              event.target.value = "";
            };
            reader.readAsText(file);
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

function ContextMenuItem({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "w-full px-3 py-1.5 text-left text-xs text-text-primary hover:bg-surface-2",
        disabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
      )}
    >
      {label}
    </button>
  );
}
