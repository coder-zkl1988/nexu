/**
 * canvas-ui-prefs.test.ts — TDD (W4.1): ui-prefs module store.
 *
 * Test matrix:
 *  a. Default: minimapVisible = true
 *  b. setCanvasUiPref persists to localStorage
 *  c. Reload-merge: corrupt JSON → defaults
 *  d. Reset helper works
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  __reloadCanvasUiPrefsForTests,
  __resetCanvasUiPrefsForTests,
  getCanvasUiPrefs,
  setCanvasUiPref,
} from "../src/lib/canvas/canvas-ui-prefs";

// Minimal localStorage polyfill (same pattern as canvas-batch.test.tsx)
if (typeof globalThis.localStorage === "undefined") {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

const PREFS_KEY = "nexu:canvas:ui-prefs";

beforeEach(() => {
  __resetCanvasUiPrefsForTests();
  localStorage.clear();
});

describe("getCanvasUiPrefs", () => {
  it("defaults: minimapVisible is true", () => {
    expect(getCanvasUiPrefs().minimapVisible).toBe(true);
  });
});

describe("setCanvasUiPref", () => {
  it("sets minimapVisible to false", () => {
    setCanvasUiPref("minimapVisible", false);
    expect(getCanvasUiPrefs().minimapVisible).toBe(false);
  });

  it("persists to localStorage", () => {
    setCanvasUiPref("minimapVisible", false);
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw == null) throw new Error("expected localStorage entry");
    const parsed = JSON.parse(raw) as { minimapVisible: boolean };
    expect(parsed.minimapVisible).toBe(false);
  });

  it("re-setting to true updates store and localStorage", () => {
    setCanvasUiPref("minimapVisible", false);
    setCanvasUiPref("minimapVisible", true);
    expect(getCanvasUiPrefs().minimapVisible).toBe(true);
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw == null) throw new Error("expected localStorage entry");
    const parsed = JSON.parse(raw) as { minimapVisible: boolean };
    expect(parsed.minimapVisible).toBe(true);
  });
});

describe("corrupt JSON in localStorage → defaults", () => {
  it("falls back to defaults when stored value is invalid JSON", () => {
    setCanvasUiPref("minimapVisible", false); // non-default live state
    localStorage.setItem(PREFS_KEY, "not-valid-json{{");
    // reload exercises the real loadStoredPrefs path (parse failure → defaults)
    __reloadCanvasUiPrefsForTests();
    expect(getCanvasUiPrefs().minimapVisible).toBe(true);
  });

  it("merges a partial legacy blob with defaults", () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ minimapVisible: false }));
    __reloadCanvasUiPrefsForTests();
    expect(getCanvasUiPrefs().minimapVisible).toBe(false);
  });
});

describe("__resetCanvasUiPrefsForTests", () => {
  it("restores defaults after a pref change", () => {
    setCanvasUiPref("minimapVisible", false);
    expect(getCanvasUiPrefs().minimapVisible).toBe(false);
    __resetCanvasUiPrefsForTests();
    expect(getCanvasUiPrefs().minimapVisible).toBe(true);
  });
});
