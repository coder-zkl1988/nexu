/**
 * canvas-hygiene.test.ts
 *
 * W2.0 hygiene preamble — unit tests for newly extracted/exported helpers:
 *   - clampMenuPosition (canvas-floating-menu.tsx)
 *   - genId (canvas-store.ts, exported)
 */

import { describe, expect, it } from "vitest";

// ── clampMenuPosition ──────────────────────────────────────────────

describe("clampMenuPosition", () => {
  // Dynamically imported so the file must exist and export the function.
  it("center position is unchanged", async () => {
    const { clampMenuPosition } = await import(
      "../src/lib/canvas/canvas-floating-menu"
    );
    // Container 800x600, menu 180x170, position at center — no clamp needed.
    const result = clampMenuPosition(310, 215, 800, 600);
    expect(result).toEqual({ x: 310, y: 215 });
  });

  it("right-bottom overflow clamps to container-menu-floor", async () => {
    const { clampMenuPosition } = await import(
      "../src/lib/canvas/canvas-floating-menu"
    );
    // Position at 800, 600 — well beyond container 800x600 for default menu 180x170.
    // Expected: clamped to (800 - 180 - 8, 600 - 170 - 8) = (612, 422).
    const result = clampMenuPosition(800, 600, 800, 600);
    expect(result.x).toBe(612);
    expect(result.y).toBe(422);
  });

  it("tiny container floors at 8 (not negative)", async () => {
    const { clampMenuPosition } = await import(
      "../src/lib/canvas/canvas-floating-menu"
    );
    // Container 50x50, menu 180x170. Container width < menuWidth + 2*floor,
    // so max clamp = max(8, 50 - 180 - 8) = max(8, -138) = 8.
    const result = clampMenuPosition(0, 0, 50, 50);
    expect(result.x).toBe(8);
    expect(result.y).toBe(8);
  });

  it("custom menu dimensions are respected", async () => {
    const { clampMenuPosition } = await import(
      "../src/lib/canvas/canvas-floating-menu"
    );
    // Override menu size to 100x80.
    // Pos (200, 200), container 500x500, menu 100x80 → no overflow → unchanged.
    // Max x = 500 - 100 - 8 = 392. 200 < 392, so no clamp.
    const result = clampMenuPosition(200, 200, 500, 500, 100, 80);
    expect(result).toEqual({ x: 200, y: 200 });

    // Pos (450, 450), container 500x500, menu 100x80 → overflows → clamped.
    // Max x = max(8, 500 - 100 - 8) = 392. Max y = max(8, 500 - 80 - 8) = 412.
    const clamped = clampMenuPosition(450, 450, 500, 500, 100, 80);
    expect(clamped.x).toBe(392);
    expect(clamped.y).toBe(412);
  });
});

// ── genId export ───────────────────────────────────────────────────

describe("genId (canvas-store export)", () => {
  it("two calls with same prefix produce different ids", async () => {
    const { genId } = await import("../src/lib/canvas/canvas-store");
    const a = genId("text");
    const b = genId("text");
    expect(a).not.toBe(b);
  });

  it("prefix is respected in the id", async () => {
    const { genId } = await import("../src/lib/canvas/canvas-store");
    const id = genId("image");
    expect(id).toMatch(/^image-/);
  });
});
