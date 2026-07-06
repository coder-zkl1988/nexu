import { useSyncExternalStore } from "react";
import type { A2UIMessage } from "../a2ui/a2ui-types";
import { NODE_MIN_HEIGHT, NODE_MIN_WIDTH } from "./canvas-geometry";
import type { PersistedCanvas } from "./canvas-persistence";
import { getActiveStorage } from "./canvas-persistence";
export { NODE_MIN_HEIGHT, NODE_MIN_WIDTH } from "./canvas-geometry";

/**
 * Canvas v2 store — the workbench's single source of truth (design doc
 * 2026-07-03-infinite-canvas-sidebar.md §v2). Hand-rolled store following the
 * repo's xhs-batch-store pattern (useSyncExternalStore, zero deps).
 *
 * Concept model mirrors the reference infinite-canvas app (typed nodes +
 * free connections + snapshot history), reimplemented from scratch — the
 * reference is AGPL and only its interaction paradigm is borrowed.
 *
 * Serializability: everything in CanvasState round-trips through JSON for
 * export/import and history snapshots. A2UI payloads (messages + onAction
 * closures) intentionally live OUTSIDE the state in a runtime map keyed by
 * surfaceId; a2ui nodes only reference that key.
 */

// ── Types ──────────────────────────────────────────────────────

export type CanvasViewport = { x: number; y: number; scale: number };

export type CanvasNodeType =
  | "a2ui"
  | "text"
  | "image"
  | "video"
  | "audio"
  | "team-step";

export type CanvasNodeMetadata = {
  /** a2ui: surfaceId into the runtime payload map. */
  surfaceId?: string;
  /** text: note content. image/video/audio: data URL / servable URL. */
  content?: string;
  mimeType?: string;
  fontSize?: number;
  /**
   * Image/video nodes with content keep aspect ratio by default.
   * Set true to opt out of ratio lock (free resize).
   */
  freeResize?: boolean;
  /** team-step: one step of a live team run (board card is the truth). */
  step?: {
    teamId: string;
    cardId: string;
    stepId?: string;
    runId?: string;
    workflowId?: string;
    assigneeName: string;
    isApproval?: boolean;
  };
};

export interface CanvasNode {
  id: string;
  type: CanvasNodeType;
  title: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  metadata: CanvasNodeMetadata;
}

export interface CanvasConnection {
  id: string;
  fromNodeId: string;
  toNodeId: string;
}

export interface CanvasState {
  nodes: CanvasNode[];
  connections: CanvasConnection[];
  viewport: CanvasViewport;
  selectedNodeIds: string[];
  selectedConnectionId: string | null;
  panelOpen: boolean;
}

export const NODE_DEFAULT_SIZES: Record<
  CanvasNodeType,
  { width: number; height: number }
> = {
  a2ui: { width: 380, height: 420 },
  text: { width: 300, height: 180 },
  image: { width: 340, height: 240 },
  video: { width: 420, height: 260 },
  audio: { width: 340, height: 120 },
  "team-step": { width: 300, height: 200 },
};

// ── Store internals ────────────────────────────────────────────

const HISTORY_LIMIT = 50;
const HISTORY_DEBOUNCE_MS = 400;
const GEOMETRY_STORAGE_KEY = "nexu:canvas:sidebar:v2";
const PERSIST_DEBOUNCE_MS = 600;
const SIDEBAR_BOARD_ID = "sidebar";

type HistoryEntry = Pick<CanvasState, "nodes" | "connections">;

let state: CanvasState = {
  nodes: [],
  connections: [],
  viewport: loadStoredViewport(),
  selectedNodeIds: [],
  selectedConnectionId: null,
  panelOpen: false,
};

const listeners = new Set<() => void>();
const history: { past: HistoryEntry[]; future: HistoryEntry[] } = {
  past: [],
  future: [],
};
let historyTimer: ReturnType<typeof setTimeout> | null = null;
let historyBase: HistoryEntry | null = null;

// Persistence state
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistResolvers: Array<() => void> = [];
let isHydrating = false;
let hydratedOnce = false;

/** A2UI payloads (messages + action closures) — runtime only, never serialized. */
const a2uiPayloads = new Map<
  string,
  {
    messages: A2UIMessage[];
    onAction: (name: string, context: Record<string, unknown>) => void;
  }
>();

function emit(): void {
  for (const listener of listeners) listener();
}

function setState(patch: Partial<CanvasState>): void {
  const prevNodes = state.nodes;
  const prevConnections = state.connections;
  state = { ...state, ...patch };
  emit();
  // Schedule a trailing-debounce persist when content changes (not during hydration)
  if (
    !isHydrating &&
    (state.nodes !== prevNodes || state.connections !== prevConnections)
  ) {
    schedulePersist();
  }
}

function schedulePersist(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
  }
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const resolvers = persistResolvers;
    persistResolvers = [];
    const snapshot: PersistedCanvas = {
      version: 1,
      savedAt: new Date().toISOString(),
      nodes: state.nodes,
      connections: state.connections,
    };
    void getActiveStorage()
      .save(SIDEBAR_BOARD_ID, snapshot)
      .finally(() => {
        for (const resolve of resolvers) resolve();
      });
  }, PERSIST_DEBOUNCE_MS);
}

function snapshot(): HistoryEntry {
  return {
    nodes: state.nodes.map((node) => ({
      ...node,
      position: { ...node.position },
      size: { ...node.size },
      metadata: { ...node.metadata },
    })),
    connections: state.connections.map((connection) => ({ ...connection })),
  };
}

/**
 * Record the pre-change snapshot once per debounce window (reference
 * behavior: rapid drags collapse into one undo step).
 */
function recordHistory(): void {
  if (historyBase === null) {
    historyBase = snapshot();
  }
  if (historyTimer) {
    clearTimeout(historyTimer);
  }
  historyTimer = setTimeout(() => {
    if (historyBase) {
      history.past.push(historyBase);
      if (history.past.length > HISTORY_LIMIT) {
        history.past.shift();
      }
      history.future = [];
      historyBase = null;
    }
    historyTimer = null;
  }, HISTORY_DEBOUNCE_MS);
}

/** Flush a pending debounced history commit immediately (undo correctness). */
function flushHistory(): void {
  if (historyTimer) {
    clearTimeout(historyTimer);
    historyTimer = null;
  }
  if (historyBase) {
    history.past.push(historyBase);
    if (history.past.length > HISTORY_LIMIT) {
      history.past.shift();
    }
    history.future = [];
    historyBase = null;
  }
}

function loadStoredViewport(): CanvasViewport {
  try {
    const raw = localStorage.getItem(GEOMETRY_STORAGE_KEY);
    const parsed = raw
      ? (JSON.parse(raw) as { viewport?: CanvasViewport })
      : {};
    return parsed.viewport ?? { x: 0, y: 0, scale: 1 };
  } catch {
    return { x: 0, y: 0, scale: 1 };
  }
}

function persistViewport(viewport: CanvasViewport): void {
  try {
    localStorage.setItem(GEOMETRY_STORAGE_KEY, JSON.stringify({ viewport }));
  } catch {
    // Storage unavailable — viewport just won't survive a reload.
  }
}

/** localStorage writes are synchronous I/O — never run them per pan/zoom frame. */
let viewportPersistTimer: ReturnType<typeof setTimeout> | null = null;
function persistViewportDebounced(viewport: CanvasViewport): void {
  if (viewportPersistTimer) {
    clearTimeout(viewportPersistTimer);
  }
  viewportPersistTimer = setTimeout(() => {
    viewportPersistTimer = null;
    persistViewport(viewport);
  }, 300);
}

function genId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Cascade slot for the n-th node (new nodes stagger down-right). */
export function cascadePosition(index: number): { x: number; y: number } {
  return { x: 32 + (index % 8) * 44, y: 32 + (index % 8) * 40 };
}

// ── Actions ────────────────────────────────────────────────────

export function addNode(input: {
  type: CanvasNodeType;
  title: string;
  position?: { x: number; y: number };
  size?: { width: number; height: number };
  metadata?: CanvasNodeMetadata;
  id?: string;
}): CanvasNode {
  recordHistory();
  const node: CanvasNode = {
    id: input.id ?? genId(input.type),
    type: input.type,
    title: input.title,
    position: input.position ?? cascadePosition(state.nodes.length),
    size: input.size ?? NODE_DEFAULT_SIZES[input.type],
    metadata: input.metadata ?? {},
  };
  setState({
    nodes: [...state.nodes, node],
    selectedNodeIds: [node.id],
    selectedConnectionId: null,
    panelOpen: true,
  });
  return node;
}

export function updateNode(
  id: string,
  patch: Partial<Pick<CanvasNode, "title" | "metadata">>,
): void {
  recordHistory();
  setState({
    nodes: state.nodes.map((node) =>
      node.id === id
        ? {
            ...node,
            ...(patch.title !== undefined ? { title: patch.title } : {}),
            ...(patch.metadata
              ? { metadata: { ...node.metadata, ...patch.metadata } }
              : {}),
          }
        : node,
    ),
  });
}

export function moveNode(id: string, position: { x: number; y: number }): void {
  moveNodes([{ id, position }]);
}

/** Move several nodes in one state update (multi-select drag = one emit). */
export function moveNodes(
  updates: ReadonlyArray<{ id: string; position: { x: number; y: number } }>,
): void {
  if (updates.length === 0) return;
  recordHistory();
  const byId = new Map(updates.map((update) => [update.id, update.position]));
  setState({
    nodes: state.nodes.map((node) => {
      const position = byId.get(node.id);
      return position ? { ...node, position } : node;
    }),
  });
}

export function resizeNode(
  id: string,
  size: { width: number; height: number },
  position?: { x: number; y: number },
): void {
  recordHistory();
  const width = Math.max(NODE_MIN_WIDTH, size.width);
  const height = Math.max(NODE_MIN_HEIGHT, size.height);
  setState({
    nodes: state.nodes.map((node) =>
      node.id === id
        ? {
            ...node,
            size: { width, height },
            ...(position !== undefined ? { position } : {}),
          }
        : node,
    ),
  });
}

export function removeNodes(ids: readonly string[]): void {
  if (ids.length === 0) return;
  recordHistory();
  const gone = new Set(ids);
  for (const node of state.nodes) {
    if (gone.has(node.id) && node.metadata.surfaceId) {
      a2uiPayloads.delete(node.metadata.surfaceId);
    }
  }
  setState({
    nodes: state.nodes.filter((node) => !gone.has(node.id)),
    connections: state.connections.filter(
      (connection) =>
        !gone.has(connection.fromNodeId) && !gone.has(connection.toNodeId),
    ),
    selectedNodeIds: state.selectedNodeIds.filter((id) => !gone.has(id)),
  });
}

export function clearCanvas(): void {
  recordHistory();
  a2uiPayloads.clear();
  setState({
    nodes: [],
    connections: [],
    selectedNodeIds: [],
    selectedConnectionId: null,
  });
}

export function connectNodes(
  fromNodeId: string,
  toNodeId: string,
): CanvasConnection | null {
  if (fromNodeId === toNodeId) return null;
  const exists = state.connections.some(
    (connection) =>
      connection.fromNodeId === fromNodeId && connection.toNodeId === toNodeId,
  );
  if (exists) return null;
  recordHistory();
  const connection: CanvasConnection = {
    id: genId("conn"),
    fromNodeId,
    toNodeId,
  };
  setState({ connections: [...state.connections, connection] });
  return connection;
}

export function removeConnection(id: string): void {
  recordHistory();
  setState({
    connections: state.connections.filter((connection) => connection.id !== id),
    selectedConnectionId:
      state.selectedConnectionId === id ? null : state.selectedConnectionId,
  });
}

export function setViewport(viewport: CanvasViewport): void {
  setState({ viewport });
  persistViewportDebounced(viewport);
}

export function selectNodes(ids: readonly string[], additive = false): void {
  const next = additive
    ? [...new Set([...state.selectedNodeIds, ...ids])]
    : [...new Set(ids)];
  setState({ selectedNodeIds: next, selectedConnectionId: null });
}

export function selectConnection(id: string | null): void {
  setState({ selectedConnectionId: id, selectedNodeIds: [] });
}

export function clearSelection(): void {
  setState({ selectedNodeIds: [], selectedConnectionId: null });
}

export function selectAll(): void {
  setState({
    selectedNodeIds: state.nodes.map((node) => node.id),
    selectedConnectionId: null,
  });
}

export function deleteSelection(): void {
  if (state.selectedConnectionId) {
    removeConnection(state.selectedConnectionId);
    return;
  }
  removeNodes(state.selectedNodeIds);
}

export function setPanelOpen(open: boolean): void {
  setState({ panelOpen: open });
}

export function undo(): void {
  flushHistory();
  const previous = history.past.pop();
  if (!previous) return;
  history.future.push(snapshot());
  setState({
    nodes: previous.nodes,
    connections: previous.connections,
    selectedNodeIds: [],
    selectedConnectionId: null,
  });
}

export function redo(): void {
  const next = history.future.pop();
  if (!next) return;
  history.past.push(snapshot());
  setState({
    nodes: next.nodes,
    connections: next.connections,
    selectedNodeIds: [],
    selectedConnectionId: null,
  });
}

// ── A2UI bridge ────────────────────────────────────────────────

/**
 * Pin an A2UI surface as a canvas node (the openWith compatibility path).
 * Same surfaceId refreshes the payload in place instead of adding a node.
 */
export function upsertA2UINode(
  surfaceId: string,
  title: string,
  messages: A2UIMessage[],
  onAction: (name: string, context: Record<string, unknown>) => void,
): void {
  a2uiPayloads.set(surfaceId, { messages, onAction });
  const existing = state.nodes.find(
    (node) => node.metadata.surfaceId === surfaceId,
  );
  if (existing) {
    // Payload map already refreshed; nudge subscribers + open the panel.
    setState({ panelOpen: true });
    return;
  }
  addNode({
    type: "a2ui",
    title,
    metadata: { surfaceId },
  });
}

export function getA2UIPayload(surfaceId: string) {
  return a2uiPayloads.get(surfaceId) ?? null;
}

// ── Export / import ────────────────────────────────────────────

export type CanvasExportFile = {
  app: "nexu-canvas";
  version: 1;
  exportedAt: string;
  nodes: CanvasNode[];
  connections: CanvasConnection[];
};

/**
 * Serialize the canvas. a2ui nodes are skipped — their payloads are runtime
 * closures re-created by their entry points, not portable data.
 */
export function exportCanvas(): CanvasExportFile {
  return {
    app: "nexu-canvas",
    version: 1,
    exportedAt: new Date().toISOString(),
    nodes: state.nodes.filter((node) => node.type !== "a2ui"),
    connections: state.connections.filter((connection) => {
      const portable = new Set(
        state.nodes
          .filter((node) => node.type !== "a2ui")
          .map((node) => node.id),
      );
      return (
        portable.has(connection.fromNodeId) && portable.has(connection.toNodeId)
      );
    }),
  };
}

export function importCanvas(file: CanvasExportFile): void {
  if (file.app !== "nexu-canvas" || !Array.isArray(file.nodes)) {
    throw new Error("not a nexu canvas export");
  }
  recordHistory();
  flushHistory();
  setState({
    nodes: [...state.nodes, ...file.nodes],
    connections: [...state.connections, ...file.connections],
    panelOpen: true,
  });
}

// ── Test helper ────────────────────────────────────────────────

/** Reset everything (tests only). */
export function __resetCanvasForTests(): void {
  state = {
    nodes: [],
    connections: [],
    viewport: { x: 0, y: 0, scale: 1 },
    selectedNodeIds: [],
    selectedConnectionId: null,
    panelOpen: false,
  };
  history.past = [];
  history.future = [];
  historyBase = null;
  if (historyTimer) {
    clearTimeout(historyTimer);
    historyTimer = null;
  }
  if (viewportPersistTimer) {
    clearTimeout(viewportPersistTimer);
    viewportPersistTimer = null;
  }
  // Reset persistence state
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  persistResolvers = [];
  isHydrating = false;
  hydratedOnce = false;
  a2uiPayloads.clear();
  emit();
}

/**
 * Flush any pending debounced save immediately (tests only).
 * Returns a promise that resolves after the save completes.
 */
export function __flushCanvasPersistForTests(): Promise<void> {
  if (!persistTimer) {
    // No pending timer — either already flushed or nothing changed
    return Promise.resolve();
  }
  clearTimeout(persistTimer);
  persistTimer = null;
  return new Promise<void>((resolve) => {
    persistResolvers.push(resolve);
    const snapshot: PersistedCanvas = {
      version: 1,
      savedAt: new Date().toISOString(),
      nodes: state.nodes,
      connections: state.connections,
    };
    void getActiveStorage()
      .save(SIDEBAR_BOARD_ID, snapshot)
      .finally(() => {
        const resolvers = persistResolvers;
        persistResolvers = [];
        for (const r of resolvers) r();
      });
  });
}

/**
 * Hydrate canvas nodes/connections from storage.
 * - Module-level guard: only first call does work (React StrictMode double-mount safety).
 * - Merge semantics: add only nodes whose id is not already present;
 *   add only connections whose id is not present AND whose both endpoints exist.
 * - Does NOT record undo history.
 * - Does NOT schedule a save-back of the loaded data.
 * - Returns true iff anything was applied.
 */
export async function hydrateCanvasFromStorage(): Promise<boolean> {
  if (hydratedOnce) return false;
  hydratedOnce = true;

  const saved = await getActiveStorage().load(SIDEBAR_BOARD_ID);
  if (!saved) return false;

  const existingNodeIds = new Set(state.nodes.map((n) => n.id));
  const existingConnIds = new Set(state.connections.map((c) => c.id));

  const newNodes = saved.nodes.filter((n) => !existingNodeIds.has(n.id));

  // Build the full set of node ids after the merge to validate connections
  const mergedNodeIds = new Set([
    ...existingNodeIds,
    ...newNodes.map((n) => n.id),
  ]);

  const newConnections = saved.connections.filter(
    (c) =>
      !existingConnIds.has(c.id) &&
      mergedNodeIds.has(c.fromNodeId) &&
      mergedNodeIds.has(c.toNodeId),
  );

  if (newNodes.length === 0 && newConnections.length === 0) return false;

  // Apply without triggering persist or undo history
  isHydrating = true;
  try {
    state = {
      ...state,
      nodes: [...state.nodes, ...newNodes],
      connections: [...state.connections, ...newConnections],
    };
    emit();
  } finally {
    isHydrating = false;
  }

  return true;
}

/** Flush the pending history window (tests need deterministic undo points). */
export function __flushCanvasHistoryForTests(): void {
  flushHistory();
}

// ── React bindings ─────────────────────────────────────────────

export function getCanvasState(): CanvasState {
  return state;
}

export function useCanvas(): CanvasState {
  return useSyncExternalStore(
    (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    () => state,
    () => state,
  );
}
