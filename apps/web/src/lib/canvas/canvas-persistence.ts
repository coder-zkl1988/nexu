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

// ── IndexedDB implementation ────────────────────────────────────

const DB_NAME = "nexu-canvas";
const DB_VERSION = 1;
const STORE_NAME = "boards";

/**
 * Create an IndexedDB-backed CanvasStorage instance.
 * The DB connection is opened lazily once and reused (promise-memoized).
 * At most one console.warn per session on failure.
 */
export function createIndexedDBStorage(): CanvasStorage {
  let dbPromise: Promise<IDBDatabase> | null = null;
  let warnedOnce = false;

  function warnOnce(msg: string): void {
    if (!warnedOnce) {
      warnedOnce = true;
      console.warn("[canvas-persistence]", msg);
    }
  }

  function openDB(): Promise<IDBDatabase> {
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
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
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
      dbPromise = null;
    });

    return dbPromise;
  }

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
