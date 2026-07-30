import { describe, expect, it } from "vitest";
import { connectedImageConnectionIds } from "../src/lib/canvas/xhs-node";

describe("connectedImageConnectionIds", () => {
  it("finds only upstream image connections that would re-add the removed image", () => {
    const nodes = [
      {
        id: "image-a",
        type: "image" as const,
        metadata: { content: "data:image/png;base64,a" },
      },
      {
        id: "image-b",
        type: "image" as const,
        metadata: { content: "data:image/png;base64,b" },
      },
    ];
    const connections = [
      { id: "remove", fromNodeId: "image-a", toNodeId: "xhs-1" },
      { id: "keep-image", fromNodeId: "image-b", toNodeId: "xhs-1" },
      { id: "keep-target", fromNodeId: "image-a", toNodeId: "xhs-2" },
    ];

    expect(
      connectedImageConnectionIds(
        nodes,
        connections,
        "xhs-1",
        "data:image/png;base64,a",
      ),
    ).toEqual(["remove"]);
  });

  it("does not disconnect anything for a locally uploaded image", () => {
    expect(
      connectedImageConnectionIds(
        [],
        [{ id: "other", fromNodeId: "text", toNodeId: "xhs-1" }],
        "xhs-1",
        "data:image/png;base64,local",
      ),
    ).toEqual([]);
  });
});
