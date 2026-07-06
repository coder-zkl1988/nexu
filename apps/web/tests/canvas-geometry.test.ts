import { describe, expect, it } from "vitest";
import {
  NODE_MIN_HEIGHT,
  NODE_MIN_WIDTH,
  computeResizeGeometry,
} from "../src/lib/canvas/canvas-geometry";

describe("canvas-geometry constants", () => {
  it("exports the canonical min-size constants", () => {
    expect(NODE_MIN_WIDTH).toBe(160);
    expect(NODE_MIN_HEIGHT).toBe(80);
  });
});

describe("computeResizeGeometry — free resize (lockRatio: false)", () => {
  const origin = { x: 100, y: 200, width: 300, height: 150 };

  it("se grow: size increases, position unchanged", () => {
    const result = computeResizeGeometry({
      corner: "se",
      origin,
      dx: 40,
      dy: 24,
      lockRatio: false,
    });
    expect(result.width).toBe(340);
    expect(result.height).toBe(174);
    expect(result.x).toBe(100);
    expect(result.y).toBe(200);
  });

  it("nw grow: dragging nw inward (negative dx/dy) grows size, position shifts", () => {
    // nw drag with dx=-40, dy=-24 (pointer moves up-left, node expands)
    const result = computeResizeGeometry({
      corner: "nw",
      origin,
      dx: -40,
      dy: -24,
      lockRatio: false,
    });
    // width = origin.width - dx = 300 - (-40) = 340
    expect(result.width).toBe(340);
    // height = origin.height - dy = 150 - (-24) = 174
    expect(result.height).toBe(174);
    // opposite corner (se) stays fixed: se_x = origin.x + origin.width = 400
    // x = se_x - width = 400 - 340 = 60
    expect(result.x).toBe(60);
    // se_y = origin.y + origin.height = 350
    // y = se_y - height = 350 - 174 = 176
    expect(result.y).toBe(176);
  });

  it("nw shrink past min: size clamps AND opposite corner stays fixed", () => {
    // Drag nw very far right/down (positive dx/dy shrinks nw corner)
    // dx = +999 would produce width = 300 - 999 = -699, clamped to MIN_WIDTH
    const result = computeResizeGeometry({
      corner: "nw",
      origin,
      dx: 999,
      dy: 999,
      lockRatio: false,
    });
    expect(result.width).toBe(NODE_MIN_WIDTH);
    expect(result.height).toBe(NODE_MIN_HEIGHT);
    // Opposite corner (se) stays fixed:
    // se_x = origin.x + origin.width = 100 + 300 = 400
    // x = 400 - NODE_MIN_WIDTH = 240
    expect(result.x).toBe(400 - NODE_MIN_WIDTH);
    // se_y = origin.y + origin.height = 200 + 150 = 350
    // y = 350 - NODE_MIN_HEIGHT = 270
    expect(result.y).toBe(350 - NODE_MIN_HEIGHT);
    // Invariant: x + width === origin.x + origin.width (se corner fixed)
    expect(result.x + result.width).toBe(origin.x + origin.width);
    expect(result.y + result.height).toBe(origin.y + origin.height);
  });

  it("ne: width grows (positive dx), height changes with negative dy (grow up), position.y shifts, position.x unchanged", () => {
    // ne: right edge moves right (dx=+50), top edge moves up (dy=-30)
    const result = computeResizeGeometry({
      corner: "ne",
      origin,
      dx: 50,
      dy: -30,
      lockRatio: false,
    });
    // ne: right edge = origin.x + origin.width + dx, left stays fixed
    expect(result.width).toBe(350);
    // ne: top edge moves up (dy < 0 shrinks y offset); height = origin.height - dy = 150 - (-30) = 180
    expect(result.height).toBe(180);
    // x stays fixed (sw corner x is fixed for ne drag)
    expect(result.x).toBe(100);
    // sw corner y stays fixed: sw_y = origin.y + origin.height = 350
    // y = sw_y - height = 350 - 180 = 170
    expect(result.y).toBe(170);
  });

  it("sw: width grows with negative dx, height grows with positive dy, x shifts, y unchanged", () => {
    // sw: left edge moves left (dx=-50), bottom edge moves down (dy=+30)
    const result = computeResizeGeometry({
      corner: "sw",
      origin,
      dx: -50,
      dy: 30,
      lockRatio: false,
    });
    // sw: width = origin.width - dx = 300 - (-50) = 350
    expect(result.width).toBe(350);
    // sw: height = origin.height + dy = 150 + 30 = 180
    expect(result.height).toBe(180);
    // ne corner x stays fixed: ne_x = origin.x + origin.width = 400
    // x = ne_x - width = 400 - 350 = 50
    expect(result.x).toBe(50);
    // y stays fixed (ne corner y = origin.y stays for sw drag)
    expect(result.y).toBe(200);
  });

  it("se shrink past min: size clamps, position unchanged (opposite nw corner fixed)", () => {
    const result = computeResizeGeometry({
      corner: "se",
      origin,
      dx: -9999,
      dy: -9999,
      lockRatio: false,
    });
    expect(result.width).toBe(NODE_MIN_WIDTH);
    expect(result.height).toBe(NODE_MIN_HEIGHT);
    // se: nw corner stays fixed, so x/y = origin.x/y
    expect(result.x).toBe(100);
    expect(result.y).toBe(200);
  });
});

describe("computeResizeGeometry — lockRatio: true", () => {
  it("se dx=+100 dy=0: width drives, height = width/ratio", () => {
    // 200×100 origin → ratio = 2
    const origin = { x: 0, y: 0, width: 200, height: 100 };
    const result = computeResizeGeometry({
      corner: "se",
      origin,
      dx: 100,
      dy: 0,
      lockRatio: true,
    });
    // Width: 200 + 100 = 300; height = 300 / 2 = 150
    expect(result.width).toBe(300);
    expect(result.height).toBe(150);
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
  });

  it("lockRatio with height clamp: width recomputed to keep ratio", () => {
    // 200×100 origin → ratio = 2; try to shrink until height would go below MIN
    // Try very small dx that results in width=40, which means height=20 < MIN_HEIGHT(80)
    // height gets clamped to 80, then width = 80*2 = 160 = NODE_MIN_WIDTH exactly
    const origin = { x: 0, y: 0, width: 200, height: 100 };
    const result = computeResizeGeometry({
      corner: "se",
      origin,
      dx: -9999,
      dy: 0,
      lockRatio: true,
    });
    // height clamped to NODE_MIN_HEIGHT=80, width = 80*2=160
    expect(result.height).toBe(NODE_MIN_HEIGHT);
    expect(result.width).toBe(NODE_MIN_HEIGHT * 2); // = 160 = NODE_MIN_WIDTH
    // ratio preserved
    expect(result.width / result.height).toBeCloseTo(2);
  });

  it("lockRatio: guard against zero-height origin (ratio defaults to 1)", () => {
    const origin = { x: 0, y: 0, width: 200, height: 0 };
    const result = computeResizeGeometry({
      corner: "se",
      origin,
      dx: 100,
      dy: 0,
      lockRatio: true,
    });
    // ratio = 1 (guard), width = 300, height = 300
    // But height is clamped to MIN only if below it — 300 > 80, so height = 300
    expect(result.width).toBeGreaterThanOrEqual(NODE_MIN_WIDTH);
    expect(result.height).toBeGreaterThanOrEqual(NODE_MIN_HEIGHT);
    // ratio should be ~1
    expect(result.width / result.height).toBeCloseTo(1);
  });

  it("lockRatio nw grow: position compensation applied with ratio-adjusted final dims", () => {
    // 200×100 origin → ratio = 2; nw drag dx=-100
    const origin = { x: 100, y: 100, width: 200, height: 100 };
    const result = computeResizeGeometry({
      corner: "nw",
      origin,
      dx: -100,
      dy: 0,
      lockRatio: true,
    });
    // width = 200 - (-100) = 300; height = 300/2 = 150
    expect(result.width).toBe(300);
    expect(result.height).toBe(150);
    // opposite corner (se) stays fixed: se_x = 300, se_y = 200
    // x = 300 - 300 = 0; y = 200 - 150 = 50
    expect(result.x).toBe(0);
    expect(result.y).toBe(50);
  });
});
