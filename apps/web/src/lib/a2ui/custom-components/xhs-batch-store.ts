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
  pendingImageSlots?: string[];
}

interface BatchState {
  posts: XHSPost[];
}

interface BatchEntry {
  state: BatchState;
  listeners: Set<() => void>;
}

const batches = new Map<string, BatchEntry>();

type PersistedRowStatus = Extract<RowStatus, "success" | "unknown" | "error">;

interface PersistedRowState {
  status: PersistedRowStatus;
  errorMessage?: string;
}

const STATUS_STORAGE_PREFIX = "nexu:xhs-publish-status:v1";

function isPersistedRowStatus(value: unknown): value is PersistedRowStatus {
  return value === "success" || value === "unknown" || value === "error";
}

function getStatusStorageKey(batchId: string): string {
  return `${STATUS_STORAGE_PREFIX}:${encodeURIComponent(batchId)}`;
}

function readPersistedRowStates(
  batchId: string,
): Map<string, PersistedRowState> {
  const states = new Map<string, PersistedRowState>();
  if (typeof localStorage === "undefined") return states;

  try {
    const raw = localStorage.getItem(getStatusStorageKey(batchId));
    if (!raw) return states;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return states;
    }
    for (const [postId, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const candidate = value as Record<string, unknown>;
      if (!isPersistedRowStatus(candidate.status)) continue;
      states.set(postId, {
        status: candidate.status,
        errorMessage:
          typeof candidate.errorMessage === "string"
            ? candidate.errorMessage
            : undefined,
      });
    }
  } catch {
    // Storage may be unavailable in restricted browser contexts. The in-memory
    // store remains functional even when durable status restoration is not.
  }
  return states;
}

function persistRowState(
  batchId: string,
  postId: string,
  status: RowStatus,
  errorMessage?: string,
): void {
  if (typeof localStorage === "undefined") return;

  try {
    const states = readPersistedRowStates(batchId);
    if (isPersistedRowStatus(status)) {
      states.set(postId, { status, errorMessage });
    } else {
      // In-progress phases are deliberately not durable. A refresh should
      // return an interrupted attempt to idle instead of leaving it stuck.
      states.delete(postId);
    }
    const key = getStatusStorageKey(batchId);
    if (states.size === 0) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, JSON.stringify(Object.fromEntries(states)));
  } catch {
    // Keep publishing usable if storage is full or blocked.
  }
}

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
  const persistedStates = readPersistedRowStates(batchId);
  entry.state = {
    posts: seed.map((post) => {
      const persisted = persistedStates.get(post.id);
      return {
        ...post,
        status: persisted?.status ?? ("idle" as RowStatus),
        errorMessage: persisted?.errorMessage,
      };
    }),
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

export function startPostImageGeneration(
  batchId: string,
  postId: string,
  slotIds: string[],
): void {
  updatePost(batchId, postId, { pendingImageSlots: slotIds });
}

export function completePostImageGeneration(
  batchId: string,
  postId: string,
  generatedUrls: string[],
): void {
  const post = getBatch(batchId).posts.find(
    (candidate) => candidate.id === postId,
  );
  if (!post) return;
  updatePost(batchId, postId, {
    images: [...new Set([...post.images, ...generatedUrls])],
    pendingImageSlots: [],
  });
}

export function clearPostImageGeneration(
  batchId: string,
  postId: string,
): void {
  updatePost(batchId, postId, { pendingImageSlots: [] });
}

export function setRowStatus(
  batchId: string,
  postId: string,
  status: RowStatus,
  errorMessage?: string,
): void {
  updatePost(batchId, postId, { status, errorMessage });
  persistRowState(batchId, postId, status, errorMessage);
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
