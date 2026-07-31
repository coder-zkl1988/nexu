import { describe, expect, it } from "vitest";
import {
  connectedImageConnectionIds,
  connectedPhoneDeviceId,
} from "../src/lib/canvas/xhs-node";

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

describe("connectedPhoneDeviceId", () => {
  const nodes = [
    {
      id: "phone-1",
      type: "phone" as const,
      metadata: { phone: { deviceId: "device-a" } },
    },
    {
      id: "text-1",
      type: "text" as const,
      metadata: { phone: { deviceId: "not-a-phone" } },
    },
  ];

  it("resolves the device from a directly linked phone in either direction", () => {
    expect(
      connectedPhoneDeviceId(
        nodes,
        [{ id: "a", fromNodeId: "xhs-1", toNodeId: "phone-1" }],
        "xhs-1",
      ),
    ).toBe("device-a");
    expect(
      connectedPhoneDeviceId(
        nodes,
        [{ id: "b", fromNodeId: "phone-1", toNodeId: "xhs-1" }],
        "xhs-1",
      ),
    ).toBe("device-a");
  });

  it("returns null for unlinked, empty, or non-phone device metadata", () => {
    expect(
      connectedPhoneDeviceId(
        nodes,
        [{ id: "a", fromNodeId: "xhs-1", toNodeId: "text-1" }],
        "xhs-1",
      ),
    ).toBeNull();
    expect(
      connectedPhoneDeviceId(
        [
          {
            id: "phone-2",
            type: "phone" as const,
            metadata: { phone: { deviceId: "" } },
          },
        ],
        [{ id: "b", fromNodeId: "xhs-1", toNodeId: "phone-2" }],
        "xhs-1",
      ),
    ).toBeNull();
  });
});
