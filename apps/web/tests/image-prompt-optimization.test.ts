import { beforeEach, describe, expect, it, vi } from "vitest";
import { postApiV1MediaGenerateText } from "../lib/api/sdk.gen";
import {
  generateXhsImagePrompt,
  optimizeImagePrompt,
} from "../src/lib/media/image-prompt-optimization";

vi.mock("../lib/api/sdk.gen", () => ({
  postApiV1MediaGenerateText: vi.fn(),
}));

const generateTextMock = vi.mocked(postApiV1MediaGenerateText);

beforeEach(() => {
  generateTextMock.mockReset();
});

describe("image prompt optimization", () => {
  it("builds a GPT-image-2 prompt from XHS post content", async () => {
    generateTextMock.mockResolvedValue({
      data: { text: "清晨自然光下，孩子在窗边测量身高" },
      error: undefined,
    });

    await expect(
      generateXhsImagePrompt({
        title: "想让孩子长高，先做好这6件事",
        content: "保证充足睡眠，饮食均衡并坚持运动。",
        hashtags: ["儿童长高", "科学育儿"],
      }),
    ).resolves.toBe("清晨自然光下，孩子在窗边测量身高");

    expect(generateTextMock).toHaveBeenCalledWith({
      body: {
        prompt: expect.stringContaining("GPT-image-2"),
        sourceText: expect.stringContaining("想让孩子长高"),
      },
    });
  });

  it("optimizes colloquial input while removing response decoration", async () => {
    generateTextMock.mockResolvedValue({
      data: { text: '提示词："一只橘猫坐在窗边，柔和侧光，浅景深"' },
      error: undefined,
    });

    await expect(optimizeImagePrompt("弄个好看的猫咪图片")).resolves.toBe(
      "一只橘猫坐在窗边，柔和侧光，浅景深",
    );

    expect(generateTextMock).toHaveBeenCalledWith({
      body: {
        prompt: expect.stringContaining("适合 GPT-image-2"),
        sourceText: "弄个好看的猫咪图片",
      },
    });
  });

  it("requires usable source content", async () => {
    await expect(optimizeImagePrompt("   ")).rejects.toThrow(
      "请先输入图片描述",
    );
    await expect(
      generateXhsImagePrompt({ title: "", content: "", hashtags: [] }),
    ).rejects.toThrow("请先填写帖子标题或正文");
    expect(generateTextMock).not.toHaveBeenCalled();
  });
});
