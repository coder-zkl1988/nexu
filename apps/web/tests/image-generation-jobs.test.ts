import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  postApiV1MediaImageJobs: vi.fn(),
  getApiV1MediaImageJobsByJobId: vi.fn(),
}));

vi.mock("../lib/api/sdk.gen", () => apiMocks);

import { generateImageViaJob } from "../src/lib/media/image-generation-jobs";

const result = {
  url: "/generated/one.png",
  path: "/tmp/one.png",
  items: [{ url: "/generated/one.png", path: "/tmp/one.png" }],
};

describe("image generation job client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("submits once and polls until the job succeeds", async () => {
    apiMocks.postApiV1MediaImageJobs.mockResolvedValue({
      data: {
        jobId: "11111111-1111-4111-8111-111111111111",
        status: "queued",
        createdAt: "2026-08-03T00:00:00.000Z",
      },
    });
    apiMocks.getApiV1MediaImageJobsByJobId
      .mockResolvedValueOnce({
        data: {
          jobId: "11111111-1111-4111-8111-111111111111",
          status: "running",
          createdAt: "2026-08-03T00:00:00.000Z",
        },
      })
      .mockResolvedValueOnce({
        data: {
          jobId: "11111111-1111-4111-8111-111111111111",
          status: "succeeded",
          createdAt: "2026-08-03T00:00:00.000Z",
          result,
        },
      });

    await expect(
      generateImageViaJob(
        { prompt: "cat", quality: "high" },
        { pollIntervalMs: 0 },
      ),
    ).resolves.toEqual(result);
    expect(apiMocks.postApiV1MediaImageJobs).toHaveBeenCalledWith({
      body: { prompt: "cat", quality: "high" },
    });
    expect(apiMocks.getApiV1MediaImageJobsByJobId).toHaveBeenCalledTimes(2);
  });

  it("surfaces the terminal job error", async () => {
    apiMocks.postApiV1MediaImageJobs.mockResolvedValue({
      data: {
        jobId: "22222222-2222-4222-8222-222222222222",
        status: "queued",
        createdAt: "2026-08-03T00:00:00.000Z",
      },
    });
    apiMocks.getApiV1MediaImageJobsByJobId.mockResolvedValue({
      data: {
        jobId: "22222222-2222-4222-8222-222222222222",
        status: "failed",
        createdAt: "2026-08-03T00:00:00.000Z",
        error: "图像服务响应超时，请稍后重试",
      },
    });

    await expect(generateImageViaJob({ prompt: "slow" })).rejects.toThrow(
      "图像服务响应超时，请稍后重试",
    );
  });
});
