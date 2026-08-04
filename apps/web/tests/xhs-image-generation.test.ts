import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  postApiV1MediaGenerateImage: vi.fn(),
}));

vi.mock("../lib/api/sdk.gen", () => apiMocks);

import { generateXhsImages } from "../src/lib/a2ui/custom-components/xhs-image-generation";

describe("XHS image generation", () => {
  beforeEach(() => {
    apiMocks.postApiV1MediaGenerateImage.mockReset();
  });

  it("forwards the selected parameters and returns every generated image", async () => {
    apiMocks.postApiV1MediaGenerateImage.mockResolvedValue({
      data: {
        url: "/generated/one.png",
        path: "/tmp/one.png",
        items: [
          { url: "/generated/one.png", path: "/tmp/one.png" },
          { url: "/generated/two.png", path: "/tmp/two.png" },
        ],
      },
    });

    await expect(
      generateXhsImages({
        prompt: "  羽毛球拍产品摄影  ",
        model: "tabby-image-pro",
        quality: "high",
        aspectRatio: "3:4",
        size: "2K",
        count: 2,
        transparentBackground: true,
      }),
    ).resolves.toEqual(["/generated/one.png", "/generated/two.png"]);

    expect(apiMocks.postApiV1MediaGenerateImage).toHaveBeenCalledWith({
      body: {
        prompt: "羽毛球拍产品摄影",
        model: "tabby-image-pro",
        quality: "high",
        aspectRatio: "3:4",
        size: "2K",
        count: 2,
        transparentBackground: true,
      },
    });
  });

  it("uses the single-result fallback and rejects an empty response", async () => {
    apiMocks.postApiV1MediaGenerateImage.mockResolvedValueOnce({
      data: {
        url: "/generated/fallback.png",
        path: "/tmp/fallback.png",
        items: [],
      },
    });
    await expect(
      generateXhsImages({
        prompt: "封面",
        model: "",
        quality: "auto",
        aspectRatio: "",
        size: "",
        count: 1,
        transparentBackground: false,
      }),
    ).resolves.toEqual(["/generated/fallback.png"]);

    apiMocks.postApiV1MediaGenerateImage.mockResolvedValueOnce({
      data: { url: "", path: "", items: [] },
    });
    await expect(
      generateXhsImages({
        prompt: "封面",
        model: "",
        quality: "auto",
        aspectRatio: "",
        size: "",
        count: 1,
        transparentBackground: false,
      }),
    ).rejects.toThrow("生成结果中没有可用图片");
  });
});
