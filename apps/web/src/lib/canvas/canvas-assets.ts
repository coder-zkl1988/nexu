/**
 * canvas-assets.ts — runtime asset library store (W4.3).
 *
 * Save node content as reusable assets, browse via a picker, insert back.
 * Module store (useSyncExternalStore, zero deps), mirrors canvas-store.
 * Assets persist through the AssetStorage seam in canvas-persistence.ts.
 */

import { useSyncExternalStore } from "react";
import type { CanvasAsset } from "./canvas-persistence";
import { getActiveAssetStorage } from "./canvas-persistence";
import {
  type CanvasNode,
  type CanvasNodeType,
  addNode,
  genId,
  getCanvasState,
} from "./canvas-store";

export type { CanvasAsset } from "./canvas-persistence";

// ── Store internals ────────────────────────────────────────────

type CanvasAssetsState = { assets: CanvasAsset[]; loaded: boolean };

let state: CanvasAssetsState = { assets: [], loaded: false };
const listeners = new Set<() => void>();

// StrictMode-safe lazy hydration guard: shared across double-mount.
let loadPromise: Promise<void> | null = null;

function emit(): void {
  for (const listener of listeners) listener();
}

function setState(patch: Partial<CanvasAssetsState>): void {
  state = { ...state, ...patch };
  emit();
}

// ── Save-eligible node kinds ───────────────────────────────────

const ASSET_KINDS: ReadonlySet<CanvasAsset["kind"]> = new Set([
  "text",
  "image",
  "video",
  "audio",
]);

function isAssetKind(type: CanvasNodeType): type is CanvasAsset["kind"] {
  return ASSET_KINDS.has(type as CanvasAsset["kind"]);
}

// ── Lazy hydration ─────────────────────────────────────────────

/**
 * Hydrate assets from storage exactly once (StrictMode double-mount safe).
 * Concurrent calls share the same in-flight promise.
 */
export function ensureAssetsLoaded(): Promise<void> {
  if (state.loaded) return Promise.resolve();
  if (loadPromise) return loadPromise;

  loadPromise = getActiveAssetStorage()
    .list()
    .then((assets) => {
      setState({ assets, loaded: true });
    });
  return loadPromise;
}

// ── Actions ────────────────────────────────────────────────────

/**
 * Save a node's content as a reusable asset.
 * Node must be text/image/video/audio with non-empty content.
 * Optimistic state update + storage.put. Returns false (no write) otherwise.
 */
export async function saveNodeAsAsset(nodeId: string): Promise<boolean> {
  const node = getCanvasState().nodes.find((n) => n.id === nodeId);
  if (!node) return false;
  if (!isAssetKind(node.type)) return false;

  const content = node.metadata.content ?? "";
  if (!content.trim()) return false;

  const asset: CanvasAsset = {
    id: genId("asset"),
    kind: node.type,
    title: node.title,
    content,
    ...(node.metadata.mimeType !== undefined
      ? { mimeType: node.metadata.mimeType }
      : {}),
    createdAt: new Date().toISOString(),
  };

  // Optimistic: newest first.
  setState({ assets: [asset, ...state.assets] });
  await getActiveAssetStorage().put(asset);
  return true;
}

/** Remove an asset from state and storage. */
export async function removeAsset(id: string): Promise<void> {
  setState({ assets: state.assets.filter((a) => a.id !== id) });
  await getActiveAssetStorage().delete(id);
}

/**
 * Insert an asset back onto the canvas as a node of its kind.
 * Returns the created node, or null if the asset id is unknown.
 */
export function insertAssetToCanvas(id: string): CanvasNode | null {
  const asset = state.assets.find((a) => a.id === id);
  if (!asset) return null;

  return addNode({
    type: asset.kind,
    title: asset.title,
    metadata: {
      content: asset.content,
      ...(asset.mimeType !== undefined ? { mimeType: asset.mimeType } : {}),
    },
  });
}

// ── Pure helpers ───────────────────────────────────────────────

/**
 * Filter assets by kind ("all" = no kind filter) and a case-insensitive,
 * trimmed title substring query (empty query = all).
 */
export function filterAssets(
  assets: CanvasAsset[],
  kind: CanvasAsset["kind"] | "all",
  query: string,
): CanvasAsset[] {
  const q = query.trim().toLowerCase();
  return assets.filter((asset) => {
    if (kind !== "all" && asset.kind !== kind) return false;
    if (q && !asset.title.toLowerCase().includes(q)) return false;
    return true;
  });
}

/**
 * Paginate items into pages of `perPage`. Page is clamped into [1, pageCount].
 * pageCount is at least 1 (empty items → one empty page).
 */
export function paginateAssets(
  items: CanvasAsset[],
  page: number,
  perPage = 8,
): { pageItems: CanvasAsset[]; page: number; pageCount: number } {
  const pageCount = Math.max(1, Math.ceil(items.length / perPage));
  const clamped = Math.min(Math.max(1, Math.floor(page)), pageCount);
  const start = (clamped - 1) * perPage;
  return {
    pageItems: items.slice(start, start + perPage),
    page: clamped,
    pageCount,
  };
}

// ── React bindings ─────────────────────────────────────────────

export function getCanvasAssets(): CanvasAssetsState {
  return state;
}

export function useCanvasAssets(): CanvasAssetsState {
  return useSyncExternalStore(
    (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    () => state,
    () => state,
  );
}

// ── Test helper ────────────────────────────────────────────────

export function __resetCanvasAssetsForTests(): void {
  state = { assets: [], loaded: false };
  loadPromise = null;
  listeners.clear();
}
