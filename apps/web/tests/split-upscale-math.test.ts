/**
 * split-upscale-math.test.ts — TDD tests for gridPieceRects, splitChildLayout,
 * and upscaleTargetSize (W3.3+3.6a).
 *
 * These are pure-math functions — no DOM, no canvas, no React.
 */

import { describe, expect, it } from "vitest";
import {
  gridPieceRects,
  splitChildLayout,
  upscaleTargetSize,
} from "../src/lib/canvas/split-upscale-math";

// ── gridPieceRects ──────────────────────────────────────────────────────────

describe("gridPieceRects", () => {
  it("1×1 grid returns the whole image as a single piece", () => {
    const rects = gridPieceRects(200, 150, 1, 1);
    expect(rects).toHaveLength(1);
    expect(rects[0]).toEqual({
      row: 0,
      col: 0,
      x: 0,
      y: 0,
      width: 200,
      height: 150,
    });
  });

  it("2×2 even split: each piece is half width × half height", () => {
    const rects = gridPieceRects(100, 80, 2, 2);
    expect(rects).toHaveLength(4);
    // Row-major order
    expect(rects[0]).toEqual({
      row: 0,
      col: 0,
      x: 0,
      y: 0,
      width: 50,
      height: 40,
    });
    expect(rects[1]).toEqual({
      row: 0,
      col: 1,
      x: 50,
      y: 0,
      width: 50,
      height: 40,
    });
    expect(rects[2]).toEqual({
      row: 1,
      col: 0,
      x: 0,
      y: 40,
      width: 50,
      height: 40,
    });
    expect(rects[3]).toEqual({
      row: 1,
      col: 1,
      x: 50,
      y: 40,
      width: 50,
      height: 40,
    });
  });

  it("100×90 into 3×2 (rows=3, cols=2) — last col and last row absorb remainder", () => {
    // cols=2 → baseW=50; no remainder for width (100/2=50 exact)
    // rows=3 → baseH=floor(90/3)=30; no remainder for height (90/3=30 exact)
    const rects = gridPieceRects(100, 90, 3, 2);
    expect(rects).toHaveLength(6);
    // Check widths — all should be 50 (exact division)
    for (const r of rects) {
      if (r.col < 1) {
        expect(r.width).toBe(50);
      } else {
        // last col
        expect(r.width).toBe(50);
      }
    }
    // All heights should be 30
    for (const r of rects) {
      expect(r.height).toBe(30);
    }
  });

  it("exact test: 100×90 into 3×3 — last col width=34, last row height=30", () => {
    // cols=3 → baseW=floor(100/3)=33; last col=100-33*2=34
    // rows=3 → baseH=floor(90/3)=30; last row=90-30*2=30
    const rects = gridPieceRects(100, 90, 3, 3);
    expect(rects).toHaveLength(9);

    // Last column (col=2) has width 34
    const lastColRects = rects.filter((r) => r.col === 2);
    for (const r of lastColRects) {
      expect(r.width).toBe(34);
    }

    // Non-last columns have base width 33
    const nonLastColRects = rects.filter((r) => r.col < 2);
    for (const r of nonLastColRects) {
      expect(r.width).toBe(33);
    }

    // Last row (row=2) has height 30
    const lastRowRects = rects.filter((r) => r.row === 2);
    for (const r of lastRowRects) {
      expect(r.height).toBe(30);
    }
  });

  it("sum of widths per row equals imgW (exact coverage)", () => {
    const imgW = 100;
    const rects = gridPieceRects(imgW, 90, 3, 3);
    // Row 0
    const row0 = rects.filter((r) => r.row === 0);
    const totalW = row0.reduce((sum, r) => sum + r.width, 0);
    expect(totalW).toBe(imgW);
  });

  it("sum of heights per column equals imgH (exact coverage)", () => {
    const imgH = 90;
    const rects = gridPieceRects(100, imgH, 3, 3);
    const col0 = rects.filter((r) => r.col === 0);
    const totalH = col0.reduce((sum, r) => sum + r.height, 0);
    expect(totalH).toBe(imgH);
  });

  it("row-major order: row varies slower, col varies faster", () => {
    const rects = gridPieceRects(60, 60, 2, 3);
    expect(rects[0]).toMatchObject({ row: 0, col: 0 });
    expect(rects[1]).toMatchObject({ row: 0, col: 1 });
    expect(rects[2]).toMatchObject({ row: 0, col: 2 });
    expect(rects[3]).toMatchObject({ row: 1, col: 0 });
    expect(rects[4]).toMatchObject({ row: 1, col: 1 });
    expect(rects[5]).toMatchObject({ row: 1, col: 2 });
  });

  it("positions are contiguous: piece x = sum of widths before it in row", () => {
    const rects = gridPieceRects(100, 90, 3, 3);
    // For row 0:
    const row0 = rects.filter((r) => r.row === 0).sort((a, b) => a.col - b.col);
    expect(row0[0].x).toBe(0);
    expect(row0[1].x).toBe(row0[0].width);
    expect(row0[2].x).toBe(row0[0].width + row0[1].width);
  });

  it("non-divisible width: 7×5 into 1×3 — last col absorbs remainder", () => {
    // cols=3 → baseW=floor(7/3)=2; last col=7-2*2=3
    const rects = gridPieceRects(7, 5, 1, 3);
    expect(rects).toHaveLength(3);
    expect(rects[0].width).toBe(2);
    expect(rects[1].width).toBe(2);
    expect(rects[2].width).toBe(3); // last col absorbs remainder
    const totalW = rects.reduce((s, r) => s + r.width, 0);
    expect(totalW).toBe(7);
  });

  it("100×90 into 2×3 (rows=2, cols=3) — widths sum to 100, heights to 90 per col/row", () => {
    // rows=2 → baseH=floor(90/2)=45; last row=90-45=45
    // cols=3 → baseW=floor(100/3)=33; last col=100-33*2=34
    const rects = gridPieceRects(100, 90, 2, 3);
    expect(rects).toHaveLength(6);

    // Non-last cols have width 33
    for (const r of rects.filter((r) => r.col < 2)) {
      expect(r.width).toBe(33);
    }
    // Last col (col=2) has width 34
    for (const r of rects.filter((r) => r.col === 2)) {
      expect(r.width).toBe(34);
    }

    // All rows should have height 45
    for (const r of rects) {
      expect(r.height).toBe(45);
    }

    // Per-row widths sum to 100
    for (let row = 0; row < 2; row++) {
      const rowRects = rects.filter((r) => r.row === row);
      const totalW = rowRects.reduce((sum, r) => sum + r.width, 0);
      expect(totalW).toBe(100);
    }

    // Per-col heights sum to 90
    for (let col = 0; col < 3; col++) {
      const colRects = rects.filter((r) => r.col === col);
      const totalH = colRects.reduce((sum, r) => sum + r.height, 0);
      expect(totalH).toBe(90);
    }
  });
});

// ── splitChildLayout ────────────────────────────────────────────────────────

describe("splitChildLayout", () => {
  const src = { x: 0, y: 100, width: 300, height: 200 };

  it("returns R×C layout items in row-major order", () => {
    const items = splitChildLayout(src, 2, 2, 1);
    expect(items).toHaveLength(4);
    expect(items[0]).toMatchObject({ row: 0, col: 0 });
    expect(items[1]).toMatchObject({ row: 0, col: 1 });
    expect(items[2]).toMatchObject({ row: 1, col: 0 });
    expect(items[3]).toMatchObject({ row: 1, col: 1 });
  });

  it("cell width is always 180", () => {
    const items = splitChildLayout(src, 2, 3, 1.5);
    for (const item of items) {
      expect(item.width).toBe(180);
    }
  });

  it("cell height = clamp(180/pieceAspect, 80, 320)", () => {
    // aspect 1 → height = 180
    const items1 = splitChildLayout(src, 1, 1, 1);
    expect(items1[0].height).toBe(180);

    // aspect 4 → height = clamp(45, 80, 320) = 80
    const items2 = splitChildLayout(src, 1, 1, 4);
    expect(items2[0].height).toBe(80);

    // aspect 0.5 → height = clamp(360, 80, 320) = 320
    const items3 = splitChildLayout(src, 1, 1, 0.5);
    expect(items3[0].height).toBe(320);
  });

  it("2×2 from a 300-wide src at x=0 → first column x=340", () => {
    // grid starts at { x: src.x + src.width + 40, y: src.y } = { x: 340, y: 100 }
    const items = splitChildLayout(src, 2, 2, 1);
    const col0Items = items.filter((i) => i.col === 0);
    for (const item of col0Items) {
      expect(item.x).toBe(340);
    }
  });

  it("2×2 from a 300-wide src at x=0 → second column x=540 (340 + 180 + 20)", () => {
    const items = splitChildLayout(src, 2, 2, 1);
    const col1Items = items.filter((i) => i.col === 1);
    for (const item of col1Items) {
      expect(item.x).toBe(540);
    }
  });

  it("2×2 row y positions: row0 at src.y, row1 at src.y + cellH + 20", () => {
    // pieceAspect=1 → cellH=180
    const items = splitChildLayout(src, 2, 2, 1);
    const cellH = 180; // aspect 1
    const row0Items = items.filter((i) => i.row === 0);
    const row1Items = items.filter((i) => i.row === 1);
    for (const item of row0Items) {
      expect(item.y).toBe(src.y); // 100
    }
    for (const item of row1Items) {
      expect(item.y).toBe(src.y + cellH + 20); // 100 + 180 + 20 = 300
    }
  });

  it("gaps between columns are 20px", () => {
    const items = splitChildLayout(src, 1, 3, 1);
    const sortedCols = items.sort((a, b) => a.col - b.col);
    // col0.x + 180 + 20 = col1.x
    expect(sortedCols[1].x).toBe(sortedCols[0].x + 180 + 20);
    expect(sortedCols[2].x).toBe(sortedCols[1].x + 180 + 20);
  });

  it("custom src position is respected", () => {
    const customSrc = { x: 50, y: 200, width: 400, height: 300 };
    const items = splitChildLayout(customSrc, 1, 1, 1);
    // grid starts at x: 50 + 400 + 40 = 490, y: 200
    expect(items[0].x).toBe(490);
    expect(items[0].y).toBe(200);
  });
});

// ── upscaleTargetSize ───────────────────────────────────────────────────────

describe("upscaleTargetSize", () => {
  it("1000×500 at 2048 → 2048×1024 (landscape, long edge is width)", () => {
    const result = upscaleTargetSize(1000, 500, 2048);
    expect(result).toEqual({ width: 2048, height: 1024 });
  });

  it("500×1000 at 2048 → 1024×2048 (portrait, long edge is height)", () => {
    const result = upscaleTargetSize(500, 1000, 2048);
    expect(result).toEqual({ width: 1024, height: 2048 });
  });

  it("4096-wide image at 4096 → null (already at target)", () => {
    const result = upscaleTargetSize(4096, 100, 4096);
    expect(result).toBeNull();
  });

  it("4097-wide image at 4096 → null (exceeds target, no downscale)", () => {
    const result = upscaleTargetSize(4097, 100, 4096);
    expect(result).toBeNull();
  });

  it("small image at 1024 → 1024 on long edge", () => {
    const result = upscaleTargetSize(400, 300, 1024);
    // long edge is 400 (width), scale = 1024/400 = 2.56
    // width = round(400 * 2.56) = 1024, height = round(300 * 2.56) = 768
    expect(result).toEqual({ width: 1024, height: 768 });
  });

  it("square image at 2048 → 2048×2048", () => {
    const result = upscaleTargetSize(100, 100, 2048);
    expect(result).toEqual({ width: 2048, height: 2048 });
  });

  it("rounding: 300×200 at 1024 → rounds correctly", () => {
    // long edge = 300, scale = 1024/300 ≈ 3.4133...
    // width = round(300 * 3.4133) = round(1024) = 1024
    // height = round(200 * 3.4133) = round(682.67) = 683
    const result = upscaleTargetSize(300, 200, 1024);
    expect(result).not.toBeNull();
    expect(result?.width).toBe(1024);
    // height: 200 * (1024/300) = 682.666... → 683
    expect(result?.height).toBe(683);
  });

  it("image already at 2048 returns null", () => {
    const result = upscaleTargetSize(2048, 1000, 2048);
    expect(result).toBeNull();
  });

  it("image at 1K, requesting 1K → null (already at/above 1K)", () => {
    const result = upscaleTargetSize(1024, 512, 1024);
    expect(result).toBeNull();
  });

  it("image smaller than 1K, requesting 1K → non-null", () => {
    const result = upscaleTargetSize(800, 600, 1024);
    expect(result).not.toBeNull();
    expect(result?.width).toBe(1024);
  });
});
