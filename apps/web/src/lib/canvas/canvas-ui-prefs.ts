/**
 * canvas-ui-prefs.ts — Module-level store for canvas UI preferences (W4.1).
 *
 * Follows the useSyncExternalStore pattern used by canvas-store.ts.
 * Persists to localStorage key `nexu:canvas:ui-prefs`; storage failures
 * degrade silently (same pattern as viewport persistence in canvas-store).
 *
 * T2 will extend this store with appearance panel prefs.
 */

import { useSyncExternalStore } from "react";

export type CanvasUiPrefs = {
  minimapVisible: boolean;
};

const PREFS_KEY = "nexu:canvas:ui-prefs";

const DEFAULTS: CanvasUiPrefs = {
  minimapVisible: true,
};

function loadStoredPrefs(): CanvasUiPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<CanvasUiPrefs>;
    // Merge with defaults so newly added prefs always have a value
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

function savePrefs(prefs: CanvasUiPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage failures degrade silently (viewport-persistence precedent)
  }
}

let prefs: CanvasUiPrefs = loadStoredPrefs();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Read the current ui-prefs snapshot (non-reactive). */
export function getCanvasUiPrefs(): CanvasUiPrefs {
  return prefs;
}

/** React hook — subscribes to pref changes via useSyncExternalStore. */
export function useCanvasUiPrefs(): CanvasUiPrefs {
  return useSyncExternalStore(
    (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    getCanvasUiPrefs,
    getCanvasUiPrefs,
  );
}

/** Update a single pref key, persist to localStorage, notify listeners. */
export function setCanvasUiPref<K extends keyof CanvasUiPrefs>(
  key: K,
  value: CanvasUiPrefs[K],
): void {
  prefs = { ...prefs, [key]: value };
  savePrefs(prefs);
  emit();
}

/**
 * Test-only: reset module state to defaults. Mirrors `__resetCanvasForTests`
 * in canvas-store. Re-reads from localStorage so tests that seed
 * localStorage before calling this get the seeded value.
 *
 * Since beforeEach calls localStorage.clear() before this, a "clean reset"
 * always yields defaults; tests that seed localStorage do so before calling
 * this function.
 */
export function __resetCanvasUiPrefsForTests(): void {
  prefs = { ...DEFAULTS };
  emit();
}
