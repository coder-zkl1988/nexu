/**
 * canvas-persistence.ts
 *
 * IndexedDB persistence for the infinite canvas (W1.1).
 * Hand-rolled native IDB — zero library deps per repo rules.
 * All failure modes (no IDB global, open error, transaction error,
 * structured-clone error) degrade gracefully: load → null, save → resolves.
 */

import type { CanvasConnection, CanvasNode } from "./canvas-store";

// ── Public types ───────────────────────────────────────────────

export type PersistedCanvas = {
  version: 1;
  savedAt: string;
  nodes: CanvasNode[];
  connections: CanvasConnection[];
};

export interface CanvasStorage {
  load(boardId: string): Promise<PersistedCanvas | null>;
  save(boardId: string, snapshot: PersistedCanvas): Promise<void>;
}

/** A reusable asset saved from node content (W4.3). */
export type CanvasAsset = {
  id: string;
  kind: "text" | "image" | "video" | "audio";
  title: string;
  content: string;
  mimeType?: string;
  /** Optional labels for library filtering (agent- or user-assigned). */
  tags?: string[];
  createdAt: string;
};

export interface AssetStorage {
  list(): Promise<CanvasAsset[]>;
  put(asset: CanvasAsset): Promise<void>;
  delete(id: string): Promise<void>;
}

// ── IndexedDB implementation ────────────────────────────────────

const DB_NAME = "nexu-canvas";
const DB_VERSION = 2;
const STORE_NAME = "boards";
const ASSET_STORE_NAME = "assets";

/**
 * Shared lazy DB opener for both the boards and assets stores.
 * One connection per session, promise-memoized. The upgrade handler only
 * CREATES missing stores so an existing v1 "boards" DB survives the v2 bump.
 */
function createSharedDBOpener(
  warnOnce: (msg: string) => void,
): () => Promise<IDBDatabase> {
  let dbPromise: Promise<IDBDatabase> | null = null;

  return function openDB(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      // Guard: IDB not available (Node env, private-browsing storage block, etc.)
      if (
        typeof globalThis.indexedDB === "undefined" ||
        globalThis.indexedDB === null
      ) {
        reject(new Error("indexedDB unavailable"));
        return;
      }

      let request: IDBOpenDBRequest;
      try {
        request = globalThis.indexedDB.open(DB_NAME, DB_VERSION);
      } catch (err) {
        reject(err);
        return;
      }

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        // Only ADD missing stores — never touch existing v1 boards data.
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
        if (!db.objectStoreNames.contains(ASSET_STORE_NAME)) {
          db.createObjectStore(ASSET_STORE_NAME, { keyPath: "id" });
        }
      };

      request.onsuccess = (event) => {
        resolve((event.target as IDBOpenDBRequest).result);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });

    // On failure reset so the next call can retry if needed
    dbPromise.catch(() => {
      warnOnce("openDB failed");
      dbPromise = null;
    });

    return dbPromise;
  };
}

/**
 * Shared warn-once helper — at most one console.warn per session.
 */
function createWarnOnce(): (msg: string) => void {
  let warnedOnce = false;
  return function warnOnce(msg: string): void {
    if (!warnedOnce) {
      warnedOnce = true;
      console.warn("[canvas-persistence]", msg);
    }
  };
}

// One warn-once + one DB opener shared by both stores (single dbPromise).
const sharedWarnOnce = createWarnOnce();
const openSharedDB = createSharedDBOpener(sharedWarnOnce);

/**
 * Create an IndexedDB-backed CanvasStorage instance.
 * Uses the shared lazy DB connection (promise-memoized, reused with assets).
 * At most one console.warn per session on failure.
 */
export function createIndexedDBStorage(): CanvasStorage {
  const warnOnce = sharedWarnOnce;
  const openDB = openSharedDB;

  return {
    async load(boardId: string): Promise<PersistedCanvas | null> {
      try {
        const db = await openDB();
        return await new Promise<PersistedCanvas | null>((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, "readonly");
          const store = tx.objectStore(STORE_NAME);
          const req = store.get(boardId);
          req.onsuccess = () => {
            const value: unknown = req.result;
            if (value == null) {
              resolve(null);
            } else if (
              typeof value === "object" &&
              (value as PersistedCanvas).version === 1
            ) {
              resolve(value as PersistedCanvas);
            } else {
              resolve(null);
            }
          };
          req.onerror = () => reject(req.error);
        });
      } catch (err) {
        warnOnce(`load failed: ${String(err)}`);
        return null;
      }
    },

    async save(boardId: string, snapshot: PersistedCanvas): Promise<void> {
      try {
        const db = await openDB();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, "readwrite");
          const store = tx.objectStore(STORE_NAME);
          const req = store.put(snapshot, boardId);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
          tx.onerror = () => reject(tx.error);
        });
      } catch (err) {
        warnOnce(`save failed: ${String(err)}`);
        // Never throws — persistence must not surface into interaction paths
      }
    },
  };
}

/**
 * Create an IndexedDB-backed AssetStorage instance (W4.3).
 * Shares the same DB connection as the boards store (single dbPromise).
 * Same graceful degradation: list → [], put/delete resolve on failure.
 */
export function createIndexedDBAssetStorage(): AssetStorage {
  const warnOnce = sharedWarnOnce;
  const openDB = openSharedDB;

  return {
    async list(): Promise<CanvasAsset[]> {
      try {
        const db = await openDB();
        return await new Promise<CanvasAsset[]>((resolve, reject) => {
          const tx = db.transaction(ASSET_STORE_NAME, "readonly");
          const store = tx.objectStore(ASSET_STORE_NAME);
          const req = store.getAll();
          req.onsuccess = () => resolve((req.result as CanvasAsset[]) ?? []);
          req.onerror = () => reject(req.error);
        });
      } catch (err) {
        warnOnce(`asset list failed: ${String(err)}`);
        return [];
      }
    },

    async put(asset: CanvasAsset): Promise<void> {
      try {
        const db = await openDB();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(ASSET_STORE_NAME, "readwrite");
          const store = tx.objectStore(ASSET_STORE_NAME);
          const req = store.put(asset);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
          tx.onerror = () => reject(tx.error);
        });
      } catch (err) {
        warnOnce(`asset put failed: ${String(err)}`);
      }
    },

    async delete(id: string): Promise<void> {
      try {
        const db = await openDB();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(ASSET_STORE_NAME, "readwrite");
          const store = tx.objectStore(ASSET_STORE_NAME);
          const req = store.delete(id);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
          tx.onerror = () => reject(tx.error);
        });
      } catch (err) {
        warnOnce(`asset delete failed: ${String(err)}`);
      }
    },
  };
}

// ── Module-level singleton + test seam ────────────────────────

const defaultStorage = createIndexedDBStorage();
let activeStorage: CanvasStorage = defaultStorage;

/**
 * Swap the storage implementation for tests.
 * Pass null to restore the default IndexedDB adapter.
 */
export function __setCanvasStorageForTests(
  storage: CanvasStorage | null,
): void {
  activeStorage = storage ?? defaultStorage;
}

export function getActiveStorage(): CanvasStorage {
  return activeStorage;
}

const defaultAssetStorage = createIndexedDBAssetStorage();
let activeAssetStorage: AssetStorage = defaultAssetStorage;

/**
 * Swap the asset storage implementation for tests.
 * Pass null to restore the default IndexedDB adapter.
 */
export function __setAssetStorageForTests(storage: AssetStorage | null): void {
  activeAssetStorage = storage ?? defaultAssetStorage;
}

export function getActiveAssetStorage(): AssetStorage {
  return activeAssetStorage;
}
