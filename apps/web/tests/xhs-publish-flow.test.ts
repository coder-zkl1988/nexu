import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  getApiV1DevicesByDeviceId: vi.fn(),
  postApiV1DevicesByDeviceIdMedia: vi.fn(),
  postApiV1DevicesByDeviceIdTasks: vi.fn(),
}));

vi.mock("../lib/api/sdk.gen", () => apiMocks);

import {
  XhsPublishStatusUnknownError,
  publishXhsPost,
} from "../src/lib/a2ui/custom-components/xhs-publish";

const POST = {
  title: "测试标题",
  content: "测试正文",
  images: [],
  hashtags: ["测试"],
};

describe("XHS publish flow", () => {
  beforeEach(() => {
    apiMocks.getApiV1DevicesByDeviceId.mockReset();
    apiMocks.postApiV1DevicesByDeviceIdMedia.mockReset();
    apiMocks.postApiV1DevicesByDeviceIdTasks.mockReset();
    apiMocks.getApiV1DevicesByDeviceId.mockResolvedValue({
      data: { status: "idle" },
    });
    apiMocks.postApiV1DevicesByDeviceIdTasks.mockResolvedValue({
      data: { result: { taskId: "task-1", success: true } },
      response: new Response(null, { status: 200 }),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("uses an idle timeout for a long-running phone publish task", async () => {
    await publishXhsPost("device-1", POST);

    expect(apiMocks.postApiV1DevicesByDeviceIdTasks).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { deviceId: "device-1" },
        body: expect.objectContaining({ timeout: 300_000 }),
      }),
    );
  });

  it("waits for a busy device instead of failing the first queued post", async () => {
    vi.useFakeTimers();
    apiMocks.getApiV1DevicesByDeviceId
      .mockResolvedValueOnce({ data: { status: "busy" } })
      .mockResolvedValue({ data: { status: "idle" } });
    const phases: string[] = [];

    const publish = publishXhsPost("device-1", POST, (phase) => {
      phases.push(phase);
    });
    await vi.advanceTimersByTimeAsync(2_000);
    await publish;

    expect(phases).toEqual(["waiting", "publishing"]);
    expect(apiMocks.postApiV1DevicesByDeviceIdTasks).toHaveBeenCalledOnce();
  });

  it("keeps a transport timeout distinct from a confirmed publish failure", async () => {
    apiMocks.postApiV1DevicesByDeviceIdTasks.mockResolvedValue({
      error: { message: "Device control request timed out" },
      response: new Response(null, { status: 504 }),
    });

    await expect(publishXhsPost("device-1", POST)).rejects.toBeInstanceOf(
      XhsPublishStatusUnknownError,
    );
  });

  it("waits and retries once when task dispatch races with another task", async () => {
    apiMocks.postApiV1DevicesByDeviceIdTasks
      .mockResolvedValueOnce({
        error: { message: "TASK_ALREADY_RUNNING: device is busy" },
        response: new Response(null, { status: 500 }),
      })
      .mockResolvedValueOnce({
        data: { result: { taskId: "task-2", success: true } },
        response: new Response(null, { status: 200 }),
      });

    await publishXhsPost("device-1", POST);

    expect(apiMocks.getApiV1DevicesByDeviceId).toHaveBeenCalledTimes(2);
    expect(apiMocks.postApiV1DevicesByDeviceIdTasks).toHaveBeenCalledTimes(2);
  });

  it("maps a missing task result to an unknown outcome", async () => {
    apiMocks.postApiV1DevicesByDeviceIdTasks.mockResolvedValue({
      data: {},
      response: new Response(null, { status: 200 }),
    });

    await expect(publishXhsPost("device-1", POST)).rejects.toBeInstanceOf(
      XhsPublishStatusUnknownError,
    );
  });

  it("converts a connected image URL to a data URL before media push", async () => {
    const drawImage = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage })),
      toDataURL: vi.fn(() => "data:image/png;base64,CONVERTED"),
    };
    class MockImage {
      naturalWidth = 640;
      naturalHeight = 800;
      crossOrigin = "";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(_source: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal("Image", MockImage);
    vi.stubGlobal("document", {
      createElement: vi.fn(() => canvas),
    });
    apiMocks.postApiV1DevicesByDeviceIdMedia.mockResolvedValue({
      data: { results: [{ success: true }] },
    });

    await publishXhsPost("device-1", {
      ...POST,
      images: ["https://cdn.example.test/cover.jpg"],
    });

    expect(drawImage).toHaveBeenCalledOnce();
    expect(apiMocks.postApiV1DevicesByDeviceIdMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          images: [
            expect.objectContaining({
              mimeType: "image/png",
              dataBase64: "CONVERTED",
            }),
          ],
        },
      }),
    );
  });
});
