import { describe, expect, it, vi } from "vitest";
import { reportXhsPublishResults } from "../src/lib/a2ui/custom-components/xhs-publish";

describe("XHS publish result round-trip", () => {
  it("reports one terminal editor failure and preserves the phone question", () => {
    const onAction = vi.fn();
    const message =
      "检测到有未完成的草稿，请问您是要继续编辑之前的草稿，还是关闭此弹窗开始新的图文笔记发布？";

    reportXhsPublishResults(onAction, {
      source: "editor",
      batchId: "batch-1",
      results: [
        {
          postId: "post-1",
          title: "这个夏天，世界杯足球靠近",
          deviceId: "device-1",
          status: "error",
          message,
        },
      ],
    });

    expect(onAction).toHaveBeenCalledOnce();
    expect(onAction).toHaveBeenCalledWith(
      "xhs_publish_result",
      expect.objectContaining({
        source: "editor",
        batchId: "batch-1",
        terminal: true,
        successCount: 0,
        errorCount: 1,
        requiresUserInput: true,
        results: [expect.objectContaining({ message })],
      }),
    );
  });

  it("aggregates a batch into one bot event", () => {
    const onAction = vi.fn();

    reportXhsPublishResults(onAction, {
      source: "batch",
      batchId: "batch-2",
      results: [
        {
          postId: "post-1",
          title: "第一篇",
          deviceId: "device-1",
          status: "error",
          message: "发布失败",
        },
        {
          postId: "post-2",
          title: "第二篇",
          deviceId: "device-2",
          status: "success",
          message: "手机端已完成发布",
        },
      ],
    });

    expect(onAction).toHaveBeenCalledOnce();
    expect(onAction).toHaveBeenCalledWith(
      "xhs_publish_result",
      expect.objectContaining({
        source: "batch",
        successCount: 1,
        errorCount: 1,
        requiresUserInput: false,
      }),
    );
  });

  it("does nothing when a detached canvas node has no chat action handler", () => {
    expect(() =>
      reportXhsPublishResults(undefined, {
        source: "editor",
        results: [],
      }),
    ).not.toThrow();
  });
});
