import { describe, expect, it } from "vitest";
import {
  clearPostImageGeneration,
  completePostImageGeneration,
  getBatch,
  seedBatch,
  startPostImageGeneration,
  updatePost,
} from "../src/lib/a2ui/custom-components/xhs-batch-store";

describe("XHS batch image generation state", () => {
  it("keeps loading slots across editor switches and merges results into the latest post", () => {
    const batchId = "image-generation-editor-switch";
    seedBatch(batchId, [
      {
        id: "post-1",
        title: "第一篇",
        content: "正文",
        images: ["/existing.png"],
        hashtags: [],
        deviceId: "device-1",
      },
    ]);

    startPostImageGeneration(batchId, "post-1", ["slot-1", "slot-2"]);
    expect(getBatch(batchId).posts[0]?.pendingImageSlots).toEqual([
      "slot-1",
      "slot-2",
    ]);

    // Simulate an edit made while the original editor instance is unmounted.
    updatePost(batchId, "post-1", {
      images: ["/existing.png", "/added-while-waiting.png"],
    });
    completePostImageGeneration(batchId, "post-1", [
      "/generated.png",
      "/existing.png",
    ]);

    expect(getBatch(batchId).posts[0]).toMatchObject({
      images: ["/existing.png", "/added-while-waiting.png", "/generated.png"],
      pendingImageSlots: [],
    });
  });

  it("clears persisted loading slots when generation fails", () => {
    const batchId = "image-generation-failure";
    seedBatch(batchId, [
      {
        id: "post-1",
        title: "失败场景",
        content: "正文",
        images: [],
        hashtags: [],
        deviceId: "device-1",
      },
    ]);

    startPostImageGeneration(batchId, "post-1", ["slot-1"]);
    clearPostImageGeneration(batchId, "post-1");

    expect(getBatch(batchId).posts[0]?.pendingImageSlots).toEqual([]);
  });
});
