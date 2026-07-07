/**
 * canvas-ui-prefs.test.ts — TDD (W4.1 + W4.2): ui-prefs module store.
 *
 * Test matrix (W4.1):
 *  a. Default: minimapVisible = true
 *  b. setCanvasUiPref persists to localStorage
 *  c. Reload-merge: corrupt JSON → defaults
 *  d. Reset helper works
 *
 * Test matrix (W4.2):
 *  e. New defaults: gridMode = "dots", showImageInfo = false
 *  f. setCanvasUiPref for new keys
 *  g. Legacy-blob merge: blob with only minimapVisible → gridMode defaults to "dots"
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

// ── W4.2: new prefs ────────────────────────────────────────────────

describe("W4.2 new defaults", () => {
  it("gridMode defaults to 'dots'", () => {
    expect(getCanvasUiPrefs().gridMode).toBe("dots");
  });

  it("showImageInfo defaults to false", () => {
    expect(getCanvasUiPrefs().showImageInfo).toBe(false);
  });
});

describe("W4.2 setCanvasUiPref for new keys", () => {
  it("sets gridMode to 'lines'", () => {
    setCanvasUiPref("gridMode", "lines");
    expect(getCanvasUiPrefs().gridMode).toBe("lines");
  });

  it("sets gridMode to 'blank'", () => {
    setCanvasUiPref("gridMode", "blank");
    expect(getCanvasUiPrefs().gridMode).toBe("blank");
  });

  it("sets showImageInfo to true", () => {
    setCanvasUiPref("showImageInfo", true);
    expect(getCanvasUiPrefs().showImageInfo).toBe(true);
  });
});

describe("W4.2 legacy-blob merge", () => {
  it("a blob with only minimapVisible gets gridMode default 'dots'", () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ minimapVisible: false }));
    __reloadCanvasUiPrefsForTests();
    expect(getCanvasUiPrefs().gridMode).toBe("dots");
    expect(getCanvasUiPrefs().showImageInfo).toBe(false);
    // original preserved
    expect(getCanvasUiPrefs().minimapVisible).toBe(false);
  });
});
