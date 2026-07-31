import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  getApiV1DevicesByDeviceId: vi.fn(),
  postApiV1DevicesByDeviceIdMedia: vi.fn(),
  postApiV1DevicesByDeviceIdTasks: vi.fn(),
}));

vi.mock("../lib/api/sdk.gen", () => apiMocks);

import {
  XhsPublishStatusUnknownError,
  buildXhsPublishTask,
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

  it("uses the text-only entry and skips media push when there are no images", async () => {
    await publishXhsPost("device-1", POST);

    expect(apiMocks.postApiV1DevicesByDeviceIdMedia).not.toHaveBeenCalled();
    const taskRequest = apiMocks.postApiV1DevicesByDeviceIdTasks.mock
      .calls[0]?.[0] as { body: { task: string } };
    expect(taskRequest.body.task).toContain("发布一篇小红书文字笔记");
    expect(taskRequest.body.task).toContain("必须选择「写文字」");
    expect(taskRequest.body.task).toContain(
      "若已经进入相册页，立即返回发布类型面板",
    );
    expect(taskRequest.body.task).not.toContain("发布一篇小红书图文笔记");
    expect(taskRequest.body.task).not.toContain("【配图】");
  });

  it("carries the desktop publish confirmation through to the phone task", () => {
    const task = buildXhsPublishTask(POST);

    expect(task).toContain("该点击就是本次公开发布的最终确认");
    expect(task).toContain("非关键选项使用平台默认值");
    expect(task).toContain("必须直接点击手机端最终");
    expect(task).toContain("不得再次询问用户是否确认");
    expect(task).toContain("只有遇到账号状态异常、需人工身份校验");
    expect(task).not.toContain("登录、验证码");
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
      data: { results: [{ mediaId: "media-1", success: true }] },
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
    expect(apiMocks.postApiV1DevicesByDeviceIdTasks).toHaveBeenCalledOnce();
  });

  it("targets the pushed Tabby album and sends a content.publish policy", async () => {
    apiMocks.postApiV1DevicesByDeviceIdMedia.mockResolvedValue({
      data: { results: [{ mediaId: "media-1", success: true }] },
    });

    await publishXhsPost("device-1", {
      ...POST,
      images: ["data:image/png;base64,IMAGE"],
    });

    const mediaRequest = apiMocks.postApiV1DevicesByDeviceIdMedia.mock
      .calls[0]?.[0] as { body: { images: Array<{ filename: string }> } };
    const taskRequest = apiMocks.postApiV1DevicesByDeviceIdTasks.mock
      .calls[0]?.[0] as {
      body: {
        task: string;
        taskPolicy: Record<string, unknown>;
      };
    };
    const filename = mediaRequest.body.images[0]?.filename;

    expect(filename).toMatch(/^xhs-\d+-0\.png$/);
    expect(taskRequest.body.task).toContain("相册「Tabby」");
    expect(taskRequest.body.task).toContain(`「${filename}」`);
    expect(taskRequest.body.task).toContain(
      "不得在「全部」「最近项目」或其他相册中猜选",
    );
    expect(taskRequest.body.task).not.toContain("只选择相册「最近项目」");
    expect(taskRequest.body.taskPolicy).toEqual({
      operationClass: "content.publish",
      targetPackages: ["com.xingin.xhs"],
      allowedAppRoles: [
        "target_app",
        "gallery",
        "file_picker",
        "system_dialog",
      ],
      allowedApps: ["com.xingin.xhs"],
    });
  });

  it.each([
    [
      "the media API returns an error",
      { error: { message: "device media channel unavailable" } },
    ],
    ["the media API returns no data", {}],
    ["the phone returns no confirmations", { data: { results: [] } }],
    [
      "the phone reports a failed image",
      {
        data: {
          results: [
            { mediaId: "media-1", success: false, error: "save failed" },
          ],
        },
      },
    ],
    [
      "the phone omits the media correlation id",
      { data: { results: [{ mediaId: "", success: true }] } },
    ],
  ])("stops before task dispatch when %s", async (_case, mediaResponse) => {
    apiMocks.postApiV1DevicesByDeviceIdMedia.mockResolvedValue(mediaResponse);

    await expect(
      publishXhsPost("device-1", {
        ...POST,
        images: ["data:image/png;base64,IMAGE"],
      }),
    ).rejects.toThrow(/图片推送/);

    expect(apiMocks.postApiV1DevicesByDeviceIdTasks).not.toHaveBeenCalled();
  });

  it("rejects partial media confirmation before dispatching the phone task", async () => {
    apiMocks.postApiV1DevicesByDeviceIdMedia.mockResolvedValue({
      data: { results: [{ mediaId: "media-1", success: true }] },
    });

    await expect(
      publishXhsPost("device-1", {
        ...POST,
        images: [
          "data:image/png;base64,IMAGE_ONE",
          "data:image/png;base64,IMAGE_TWO",
        ],
      }),
    ).rejects.toThrow("图片推送未完成 1/2 张");

    expect(apiMocks.postApiV1DevicesByDeviceIdTasks).not.toHaveBeenCalled();
  });

  it("keeps blank lines and writes normalized hashtags in the body once", () => {
    const task = buildXhsPublishTask({
      title: "新手球拍怎么选",
      content: "第一段\n\n第二段\n\n",
      images: ["data:image/png;base64,IMAGE"],
      hashtags: ["#羽毛球推荐", "羽毛球新手", "羽毛球推荐", ""],
    });

    expect(task).toContain(
      "<<<正文与话题开始>>>\n第一段\n\n第二段\n\n#羽毛球推荐 #羽毛球新手\n<<<正文与话题结束>>>",
    );
    expect(task).not.toContain("【话题】");
    expect(task).toContain("正文输入框也只执行一次 TYPE");
    expect(task).toContain("不得点击「#话题」按钮");
    expect(task).toContain("绝不能选择相册第一张");
  });
});
