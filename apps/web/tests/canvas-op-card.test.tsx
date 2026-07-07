/**
 * canvas-op-card.test.tsx
 *
 * S8 frontend (W4.5b): the confirm card that appears in chat when the agent
 * emits canvas ops. Static markup assertions (renderToStaticMarkup) — the card
 * summary, per-op list lines, the 应用/忽略 buttons, and their data attrs.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CanvasOpCard } from "../src/lib/canvas/canvas-op-card";

describe("CanvasOpCard", () => {
  it("renders the card shell, title, summary, and confirm/dismiss buttons", () => {
    const markup = renderToStaticMarkup(
      <CanvasOpCard
        batch={{
          ops: [
            { op: "add_node", ref: "a", nodeType: "text", title: "A" },
            { op: "connect", from: "ref:a", to: "ref:a" },
          ],
          summary: "加两个节点",
        }}
      />,
    );

    expect(markup).toContain("data-canvas-op-card");
    expect(markup).toContain("画布操作");
    expect(markup).toContain("加两个节点");
    expect(markup).toContain("data-canvas-op-apply");
    expect(markup).toContain("data-canvas-op-dismiss");
    expect(markup).toContain("应用");
    expect(markup).toContain("忽略");
  });

  it("falls back to an op-count summary when none is provided", () => {
    const markup = renderToStaticMarkup(
      <CanvasOpCard
        batch={{
          ops: [{ op: "set_viewport", x: 0, y: 0, scale: 1 }],
        }}
      />,
    );
    expect(markup).toContain("1 项操作");
  });

  it("renders a per-op summary line for each op type", () => {
    const markup = renderToStaticMarkup(
      <CanvasOpCard
        batch={{
          ops: [
            { op: "add_node", ref: "a", nodeType: "text", title: "A" },
            { op: "delete_node", target: "n1" },
            { op: "connect", from: "n1", to: "n2" },
            { op: "set_viewport", x: 0, y: 0, scale: 1 },
          ],
        }}
      />,
    );
    // One line per op — text node label, delete, connect, viewport.
    expect(markup).toContain("文本");
    expect(markup).toContain("删除");
    expect(markup).toContain("连接");
    expect(markup).toContain("视口");
  });

  it("renders labels for the image-editing ops (image-ops B)", () => {
    const markup = renderToStaticMarkup(
      <CanvasOpCard
        batch={{
          ops: [
            { op: "crop_image", target: "n1", x: 0, y: 0, w: 100, h: 80 },
            { op: "split_image", target: "n1", rows: 2, cols: 3 },
            {
              op: "upscale_image",
              target: "n1",
              targetLongEdge: 4096,
              algorithm: "high",
            },
            {
              op: "enhance_image",
              target: "n1",
              operation: "multi-angle",
            },
            { op: "describe_image", target: "n1" },
          ],
        }}
      />,
    );
    expect(markup).toContain("裁剪");
    expect(markup).toContain("拆分为 2×3");
    expect(markup).toContain("放大到 4K");
    expect(markup).toContain("多角度");
    expect(markup).toContain("反推提示词");
  });
});
