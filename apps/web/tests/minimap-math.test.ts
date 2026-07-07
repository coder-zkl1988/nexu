/**
 * minimap-math.test.ts — TDD (W4.1): pure minimap math module.
 *
 * Test matrix:
 *  a. worldBoundsOf: union incl. viewport / null case
 *  b. minimapLayout: fit (wide → width-limited; padding; degenerate → scale≤1, no NaN)
 *  c. point round-trip: world→mini→world within epsilon
 */

import { describe, expect, it } from "vitest";
import {
  minimapLayout,
  minimapPointToWorld,
  worldBoundsOf,
} from "../src/lib/canvas/minimap-math";

describe("worldBoundsOf", () => {
  const node = (x: number, y: number, w: number, h: number) => ({
    position: { x, y },
    size: { width: w, height: h },
  });

  it("returns null when no nodes and no viewport", () => {
    expect(worldBoundsOf([], null)).toBeNull();
  });

  it("returns node rect for a single node, no viewport", () => {
    const result = worldBoundsOf([node(10, 20, 100, 80)], null);
    if (result == null) throw new Error("expected non-null result");
    expect(result.minX).toBe(10);
    expect(result.minY).toBe(20);
    expect(result.maxX).toBe(110);
    expect(result.maxY).toBe(100);
  });

  it("unions multiple nodes", () => {
    const result = worldBoundsOf(
      [node(0, 0, 100, 100), node(200, 150, 50, 50)],
      null,
    );
    if (result == null) throw new Error("expected non-null result");
    expect(result.minX).toBe(0);
    expect(result.minY).toBe(0);
    expect(result.maxX).toBe(250);
    expect(result.maxY).toBe(200);
  });

  it("includes viewport rect in union when provided", () => {
    // single node at (100, 100), viewport extends further left and up
    const result = worldBoundsOf([node(100, 100, 50, 50)], {
      x: -50,
      y: -30,
      width: 400,
      height: 300,
    });
    if (result == null) throw new Error("expected non-null result");
    expect(result.minX).toBe(-50);
    expect(result.minY).toBe(-30);
    expect(result.maxX).toBe(350); // max(-50+400=350, 100+50=150) → 350
    expect(result.maxY).toBe(270); // max(-30+300=270, 100+50=150) → 270
  });

  it("returns viewport rect when no nodes given", () => {
    const result = worldBoundsOf([], { x: 0, y: 0, width: 800, height: 600 });
    if (result == null) throw new Error("expected non-null result");
    expect(result.minX).toBe(0);
    expect(result.minY).toBe(0);
    expect(result.maxX).toBe(800);
    expect(result.maxY).toBe(600);
  });
});

describe("minimapLayout", () => {
  it("wide bounds → width-limited scale, centered vertically", () => {
    // wide: 800×100, mini: 200×132, padding=8 → avail 184×116
    // fitW = 184/800=0.23, fitH = 116/100=1.16 → scale = 0.23
    const layout = minimapLayout(
      { minX: 0, minY: 0, maxX: 800, maxY: 100 },
      { width: 200, height: 132 },
      8,
    );
    expect(layout.scale).toBeCloseTo(184 / 800, 5);
    // The mapped left edge of minX should equal padding
    const mappedLeft = (0 - layout.offsetX) * layout.scale;
    expect(mappedLeft).toBeCloseTo(8, 4);
  });

  it("tall bounds → height-limited scale", () => {
    // tall: 100×800, mini: 200×132, padding=8 → avail 184×116
    // fitW = 184/100=1.84, fitH = 116/800=0.145 → scale = 0.145
    const layout = minimapLayout(
      { minX: 0, minY: 0, maxX: 100, maxY: 800 },
      { width: 200, height: 132 },
      8,
    );
    expect(layout.scale).toBeCloseTo(116 / 800, 5);
  });

  it("respects custom padding", () => {
    const layoutP0 = minimapLayout(
      { minX: 0, minY: 0, maxX: 400, maxY: 200 },
      { width: 200, height: 132 },
      0,
    );
    const layoutP16 = minimapLayout(
      { minX: 0, minY: 0, maxX: 400, maxY: 200 },
      { width: 200, height: 132 },
      16,
    );
    expect(layoutP16.scale).toBeLessThan(layoutP0.scale);
  });

  it("default padding is 8", () => {
    const layoutDefault = minimapLayout(
      { minX: 0, minY: 0, maxX: 400, maxY: 200 },
      { width: 200, height: 132 },
    );
    const layoutP8 = minimapLayout(
      { minX: 0, minY: 0, maxX: 400, maxY: 200 },
      { width: 200, height: 132 },
      8,
    );
    expect(layoutDefault.scale).toBeCloseTo(layoutP8.scale, 8);
    expect(layoutDefault.offsetX).toBeCloseTo(layoutP8.offsetX, 8);
  });

  it("degenerate zero-size bounds → scale ≤ 1, no NaN", () => {
    const layout = minimapLayout(
      { minX: 100, minY: 100, maxX: 100, maxY: 100 },
      { width: 200, height: 132 },
      8,
    );
    expect(layout.scale).toBeLessThanOrEqual(1);
    expect(Number.isNaN(layout.scale)).toBe(false);
    expect(Number.isNaN(layout.offsetX)).toBe(false);
    expect(Number.isNaN(layout.offsetY)).toBe(false);
  });
});

describe("minimapPointToWorld — round-trip", () => {
  it("maps a world point through layout and back within epsilon", () => {
    const bounds = { minX: 50, minY: 50, maxX: 850, maxY: 450 };
    const mini = { width: 200, height: 132 };
    const layout = minimapLayout(bounds, mini, 8);

    // Simulate: take a world point, compute its mini position, then invert
    const worldPt = { x: 300, y: 200 };
    const miniX = (worldPt.x - layout.offsetX) * layout.scale;
    const miniY = (worldPt.y - layout.offsetY) * layout.scale;

    const recovered = minimapPointToWorld({ x: miniX, y: miniY }, layout);
    expect(recovered.x).toBeCloseTo(worldPt.x, 6);
    expect(recovered.y).toBeCloseTo(worldPt.y, 6);
  });

  it("maps the mini origin to the offsetX/offsetY world point", () => {
    const bounds = { minX: 0, minY: 0, maxX: 400, maxY: 200 };
    const layout = minimapLayout(bounds, { width: 200, height: 132 }, 8);
    // mini (0,0) should map to the world origin of the padded region
    const world = minimapPointToWorld({ x: 0, y: 0 }, layout);
    // world point at (0,0) mini ← offsetX world point
    expect(world.x).toBeCloseTo(layout.offsetX, 6);
    expect(world.y).toBeCloseTo(layout.offsetY, 6);
  });
});
