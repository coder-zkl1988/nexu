import { useSyncExternalStore } from "react";

/**
 * Client-side source of truth for an XHS batch-publish session.
 *
 * The A2UI message that renders the batch table only SEEDS this store; from
 * then on the inline table and expanded editor both read/write the same store
 * (keyed by batchId), so an edit reflects in the table row instantly and a
 * publish updates the row status no matter which view triggered it.
 */

export type RowStatus =
  | "idle"
  | "waiting"
  | "pushing"
  | "publishing"
  | "success"
  | "unknown"
  | "error";

export interface XHSPost {
  id: string;
  title: string;
  content: string;
  images: string[]; // data URLs or browser-loadable URLs
  hashtags: string[];
  deviceId: string;
  status: RowStatus;
  errorMessage?: string;
}

interface BatchState {
  posts: XHSPost[];
}

interface BatchEntry {
  state: BatchState;
  listeners: Set<() => void>;
}

const batches = new Map<string, BatchEntry>();

function getEntry(batchId: string): BatchEntry {
  let entry = batches.get(batchId);
  if (!entry) {
    entry = { state: { posts: [] }, listeners: new Set() };
    batches.set(batchId, entry);
  }
  return entry;
}

function emit(entry: BatchEntry): void {
  for (const l of entry.listeners) l();
}

/** Seed the batch once (no-op if already seeded — survives re-renders). */
export function seedBatch(
  batchId: string,
  seed: Array<Omit<XHSPost, "status">>,
): void {
  const entry = getEntry(batchId);
  if (entry.state.posts.length > 0) return;
  entry.state = {
    posts: seed.map((p) => ({ ...p, status: "idle" as RowStatus })),
  };
  emit(entry);
}

export function getBatch(batchId: string): BatchState {
  return getEntry(batchId).state;
}

function patchEntry(batchId: string, next: BatchState): void {
  const entry = getEntry(batchId);
  entry.state = next;
  emit(entry);
}

/** Merge a partial update into one post (by id) and notify subscribers. */
export function updatePost(
  batchId: string,
  postId: string,
  patch: Partial<XHSPost>,
): void {
  const { posts } = getEntry(batchId).state;
  patchEntry(batchId, {
    posts: posts.map((p) => (p.id === postId ? { ...p, ...patch } : p)),
  });
}

export function setRowStatus(
  batchId: string,
  postId: string,
  status: RowStatus,
  errorMessage?: string,
): void {
  updatePost(batchId, postId, { status, errorMessage });
}

/** Subscribe a React component to a batch's state. */
export function useBatch(batchId: string): BatchState {
  const entry = getEntry(batchId);
  return useSyncExternalStore(
    (cb) => {
      entry.listeners.add(cb);
      return () => entry.listeners.delete(cb);
    },
    () => entry.state,
  );
}
