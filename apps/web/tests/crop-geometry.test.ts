import { describe, expect, it } from "vitest";
import { applyCropDrag, fitScale } from "../src/lib/canvas/crop-geometry";

describe("fitScale", () => {
  it("downscales when image exceeds max", () => {
    expect(fitScale(1280, 800, 640, 400)).toBe(0.5);
  });

  it("does not upscale past 1", () => {
    expect(fitScale(320, 200, 640, 400)).toBe(1);
  });

  it("is bounded by width axis", () => {
    expect(fitScale(1280, 400, 640, 400)).toBe(0.5);
  });

  it("is bounded by height axis", () => {
    expect(fitScale(400, 800, 640, 400)).toBe(0.5);
  });

  it("exact fit returns 1", () => {
    expect(fitScale(640, 400, 640, 400)).toBe(1);
  });
});

describe("applyCropDrag — move handle", () => {
  const bounds = { width: 500, height: 400 };
  const box = { x: 50, y: 50, width: 200, height: 100 };

  it("translates correctly", () => {
    const result = applyCropDrag({
      handle: "move",
      box,
      dx: 10,
      dy: 20,
      bounds,
      lockRatio: false,
    });
    expect(result.x).toBe(60);
    expect(result.y).toBe(70);
    expect(result.width).toBe(200);
    expect(result.height).toBe(100);
  });

  it("clamps at left bound", () => {
    const result = applyCropDrag({
      handle: "move",
      box,
      dx: -100,
      dy: 0,
      bounds,
      lockRatio: false,
    });
    expect(result.x).toBe(0);
  });

  it("clamps at top bound", () => {
    const result = applyCropDrag({
      handle: "move",
      box,
      dx: 0,
      dy: -100,
      bounds,
      lockRatio: false,
    });
    expect(result.y).toBe(0);
  });

  it("clamps at right bound", () => {
    const result = applyCropDrag({
      handle: "move",
      box,
      dx: 300,
      dy: 0,
      bounds,
      lockRatio: false,
    });
    expect(result.x).toBe(bounds.width - box.width); // 300
  });

  it("clamps at bottom bound", () => {
    const result = applyCropDrag({
      handle: "move",
      box,
      dx: 0,
      dy: 400,
      bounds,
      lockRatio: false,
    });
    expect(result.y).toBe(bounds.height - box.height); // 300
  });
});

describe("applyCropDrag — se (grow)", () => {
  const bounds = { width: 500, height: 400 };
  const box = { x: 50, y: 50, width: 200, height: 100 };

  it("grows right and bottom edges", () => {
    const result = applyCropDrag({
      handle: "se",
      box,
      dx: 40,
      dy: 20,
      bounds,
      lockRatio: false,
    });
    expect(result.x).toBe(50); // opposite (nw) fixed
    expect(result.y).toBe(50);
    expect(result.width).toBe(240);
    expect(result.height).toBe(120);
  });

  it("opposite edge (nw) is fixed while growing", () => {
    const result = applyCropDrag({
      handle: "se",
      box,
      dx: 50,
      dy: 50,
      bounds,
      lockRatio: false,
    });
    expect(result.x).toBe(box.x);
    expect(result.y).toBe(box.y);
  });

  it("does not exceed bounds on oversized drags", () => {
    const result = applyCropDrag({
      handle: "se",
      box,
      dx: 9999,
      dy: 9999,
      bounds,
      lockRatio: false,
    });
    expect(result.x + result.width).toBeLessThanOrEqual(bounds.width);
    expect(result.y + result.height).toBeLessThanOrEqual(bounds.height);
  });
});

describe("applyCropDrag — nw (shrink with min clamp)", () => {
  const bounds = { width: 500, height: 400 };

  it("nw shrink respects min 16 and opposite edge stays fixed", () => {
    const box = { x: 50, y: 50, width: 200, height: 100 };
    // nw drag dx=+190 — dragging right shrinks width toward 10, clamped to 16
    const result = applyCropDrag({
      handle: "nw",
      box,
      dx: 190,
      dy: 80,
      bounds,
      lockRatio: false,
    });
    // width clamped to min 16
    expect(result.width).toBeGreaterThanOrEqual(16);
    expect(result.height).toBeGreaterThanOrEqual(16);
    // opposite edge (se corner) stays fixed
    const fixedSeX = box.x + box.width; // 250
    const fixedSeY = box.y + box.height; // 150
    expect(result.x + result.width).toBe(fixedSeX);
    expect(result.y + result.height).toBe(fixedSeY);
  });
});

describe("applyCropDrag — edge handles (single-axis)", () => {
  const bounds = { width: 500, height: 400 };
  const box = { x: 50, y: 50, width: 200, height: 100 };

  it("e handle: only moves right edge (width changes, y/height unchanged)", () => {
    const result = applyCropDrag({
      handle: "e",
      box,
      dx: 30,
      dy: 99,
      bounds,
      lockRatio: false,
    });
    expect(result.x).toBe(50);
    expect(result.y).toBe(50);
    expect(result.width).toBe(230);
    expect(result.height).toBe(100); // dy is ignored
  });

  it("s handle: only moves bottom edge (height changes, x/width unchanged)", () => {
    const result = applyCropDrag({
      handle: "s",
      box,
      dx: 99,
      dy: 30,
      bounds,
      lockRatio: false,
    });
    expect(result.x).toBe(50);
    expect(result.y).toBe(50);
    expect(result.width).toBe(200); // dx is ignored
    expect(result.height).toBe(130);
  });

  it("w handle: only moves left edge", () => {
    const result = applyCropDrag({
      handle: "w",
      box,
      dx: 20,
      dy: 0,
      bounds,
      lockRatio: false,
    });
    expect(result.y).toBe(50);
    expect(result.height).toBe(100);
    expect(result.x).toBe(70); // moved right
    expect(result.width).toBe(180); // shrinks
  });

  it("n handle: only moves top edge", () => {
    const result = applyCropDrag({
      handle: "n",
      box,
      dx: 0,
      dy: 20,
      bounds,
      lockRatio: false,
    });
    expect(result.x).toBe(50);
    expect(result.width).toBe(200);
    expect(result.y).toBe(70);
    expect(result.height).toBe(80);
  });
});

describe("applyCropDrag — lockRatio on corner handles", () => {
  const bounds = { width: 1000, height: 1000 };

  it("se with lockRatio: 200×100 se dx+100 → 300×150", () => {
    const box = { x: 0, y: 0, width: 200, height: 100 };
    const result = applyCropDrag({
      handle: "se",
      box,
      dx: 100,
      dy: 0,
      bounds,
      lockRatio: true,
    });
    expect(result.width).toBe(300);
    expect(result.height).toBe(150);
    expect(result.x).toBe(0); // nw fixed
    expect(result.y).toBe(0);
  });

  it("edge handles ignore lockRatio", () => {
    const box = { x: 0, y: 0, width: 200, height: 100 };
    // e handle with lockRatio true — dy should be ignored, height stays
    const result = applyCropDrag({
      handle: "e",
      box,
      dx: 100,
      dy: 0,
      bounds,
      lockRatio: true,
    });
    expect(result.width).toBe(300);
    expect(result.height).toBe(100); // unchanged
  });
});

describe("applyCropDrag — bounds enforcement", () => {
  const bounds = { width: 300, height: 200 };

  it("box never exits bounds on oversized move", () => {
    const box = { x: 100, y: 100, width: 100, height: 50 };
    const result = applyCropDrag({
      handle: "move",
      box,
      dx: 9999,
      dy: 9999,
      bounds,
      lockRatio: false,
    });
    expect(result.x).toBeGreaterThanOrEqual(0);
    expect(result.y).toBeGreaterThanOrEqual(0);
    expect(result.x + result.width).toBeLessThanOrEqual(bounds.width);
    expect(result.y + result.height).toBeLessThanOrEqual(bounds.height);
  });

  it("box never exits bounds on oversized se drag", () => {
    const box = { x: 0, y: 0, width: 100, height: 80 };
    const result = applyCropDrag({
      handle: "se",
      box,
      dx: 9999,
      dy: 9999,
      bounds,
      lockRatio: false,
    });
    expect(result.x + result.width).toBeLessThanOrEqual(bounds.width);
    expect(result.y + result.height).toBeLessThanOrEqual(bounds.height);
  });
});
