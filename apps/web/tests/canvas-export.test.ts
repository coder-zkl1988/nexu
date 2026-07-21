import { describe, expect, it } from "vitest";
import {
  buildBoardExport,
  buildNodesExport,
  buildZip,
  crc32,
} from "../src/lib/canvas/canvas-export";
import type { CanvasNode } from "../src/lib/canvas/canvas-store";

function makeNode(
  partial: Partial<CanvasNode> & Pick<CanvasNode, "id" | "type">,
): CanvasNode {
  return {
    title: "",
    position: { x: 0, y: 0 },
    size: { width: 100, height: 100 },
    metadata: {},
    ...partial,
  };
}

// 1x1 transparent PNG
const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe("canvas export", () => {
  it("crc32 matches known vectors", () => {
    const encoder = new TextEncoder();
    // Standard test vector: crc32("123456789") = 0xCBF43926
    expect(crc32(encoder.encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it("buildZip produces a structurally valid STORE archive", async () => {
    const encoder = new TextEncoder();
    const blob = buildZip([
      { name: "a.txt", data: encoder.encode("hello") },
      { name: "文件夹/b.txt", data: encoder.encode("world") },
    ]);
    const bytes = new Uint8Array(await blob.arrayBuffer());

    // Local file header signature at offset 0: PK\x03\x04
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    // End-of-central-directory signature present: PK\x05\x06
    const eocdOffset = bytes.length - 22;
    expect([...bytes.slice(eocdOffset, eocdOffset + 4)]).toEqual([
      0x50, 0x4b, 0x05, 0x06,
    ]);
    // Total entry count in EOCD (offset +10, little-endian u16)
    const count =
      (bytes[eocdOffset + 10] as number) |
      ((bytes[eocdOffset + 11] as number) << 8);
    expect(count).toBe(2);
    // UTF-8 name flag (bit 11) set in the first local header
    const flags = (bytes[6] as number) | ((bytes[7] as number) << 8);
    expect(flags & 0x0800).toBe(0x0800);
  });

  it("buildBoardExport externalizes media content into files/", async () => {
    const nodes = [
      makeNode({
        id: "img1",
        type: "image",
        title: "封面",
        metadata: { content: PNG_DATA_URL, mimeType: "image/png" },
      }),
      makeNode({
        id: "note1",
        type: "text",
        metadata: { content: "hello note" },
      }),
    ];
    const entries = await buildBoardExport("测试画布", nodes, []);

    const names = entries.map((e) => e.name);
    expect(names[0]).toBe("board.json");
    expect(names).toContain("files/封面.png");

    const board = JSON.parse(new TextDecoder().decode(entries[0]?.data));
    expect(board.app).toBe("nexu-canvas");
    expect(board.boardName).toBe("测试画布");
    const img = board.nodes.find((n: CanvasNode) => n.id === "img1");
    expect(img.metadata.content).toBe("files/封面.png");
    // Text node content stays inline
    const note = board.nodes.find((n: CanvasNode) => n.id === "note1");
    expect(note.metadata.content).toBe("hello note");
  });

  it("buildBoardExport keeps inline content when media cannot be resolved", async () => {
    const nodes = [
      makeNode({
        id: "broken",
        type: "image",
        metadata: { content: "data:image/png" }, // malformed: no comma
      }),
    ];
    const entries = await buildBoardExport("b", nodes, []);
    expect(entries).toHaveLength(1); // board.json only
    const board = JSON.parse(new TextDecoder().decode(entries[0]?.data));
    expect(board.nodes[0].metadata.content).toBe("data:image/png");
  });

  it("buildNodesExport maps types: media→file, text→txt, config→json", async () => {
    const nodes = [
      makeNode({
        id: "img1",
        type: "image",
        title: "图",
        metadata: { content: PNG_DATA_URL },
      }),
      makeNode({
        id: "t1",
        type: "text",
        title: "笔记",
        metadata: { content: "内容" },
      }),
      makeNode({
        id: "c1",
        type: "config",
        title: "生成配置",
        metadata: { config: { mode: "image" } },
      }),
    ];
    const entries = await buildNodesExport(nodes);
    const names = entries.map((e) => e.name);
    expect(names).toEqual(["图.png", "笔记.txt", "生成配置.json"]);
    expect(new TextDecoder().decode(entries[1]?.data)).toBe("内容");
    const config = JSON.parse(new TextDecoder().decode(entries[2]?.data));
    expect(config.id).toBe("c1");
  });

  it("buildNodesExport dedupes colliding filenames", async () => {
    const nodes = [
      makeNode({
        id: "a",
        type: "text",
        title: "同名",
        metadata: { content: "1" },
      }),
      makeNode({
        id: "b",
        type: "text",
        title: "同名",
        metadata: { content: "2" },
      }),
    ];
    const entries = await buildNodesExport(nodes);
    expect(entries.map((e) => e.name)).toEqual(["同名.txt", "同名-1.txt"]);
  });
});
