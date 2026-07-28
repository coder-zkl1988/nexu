import { describe, expect, it } from "vitest";
import { classifyRunMessage } from "../src/lib/chat/run-message-intent";

describe("classifyRunMessage", () => {
  it.each([
    ["现在做到哪一步了？", "side-question"],
    ["还需要多久？", "side-question"],
    ["当前进度", "side-question"],
    ["What is the current status?", "side-question"],
    ["Are you done?", "side-question"],
    ["为什么刚才的命令失败了？", "side-question"],
    ["顺便问一下刚才为什么失败", "side-question"],
    ["旁路看下模型列表的状态", "side-question"],
    ["这个报错的原因", "side-question"],
    ["不要检查 Web，只看 Controller", "steer"],
    ["测试不用全跑，只跑相关用例", "steer"],
    ["能不能改成 SQLite？", "steer"],
    ["停止扫描依赖，只总结已经发现的问题。", "steer"],
    ["Use SQLite instead", "steer"],
    ["继续", "steer"],
    ["停止当前任务", "abort"],
    ["先暂停一下", "abort"],
    ["别做了", "abort"],
    ["stop current task", "abort"],
  ])("classifies %s as %s", (message, intent) => {
    expect(classifyRunMessage(message).intent).toBe(intent);
  });

  it("supports explicit BTW and Steer commands", () => {
    expect(classifyRunMessage("/btw 现在完成了哪些步骤？")).toEqual({
      intent: "side-question",
      message: "现在完成了哪些步骤？",
      explicit: true,
    });
    expect(classifyRunMessage("/side 当前状态？")).toEqual({
      intent: "side-question",
      message: "当前状态？",
      explicit: true,
    });
    expect(classifyRunMessage("/steer 只跑相关测试")).toEqual({
      intent: "steer",
      message: "只跑相关测试",
      explicit: true,
    });
    expect(classifyRunMessage("/tell focus on controller")).toEqual({
      intent: "steer",
      message: "focus on controller",
      explicit: true,
    });
  });

  it("only aborts on high-confidence stop messages", () => {
    expect(classifyRunMessage("为什么停止了？").intent).toBe("side-question");
    expect(classifyRunMessage("现在可以停止吗？").intent).toBe("side-question");
    expect(classifyRunMessage("停止扫描，直接总结").intent).toBe("steer");
  });

  it("defaults ambiguous busy messages to the non-mutating side lane", () => {
    expect(classifyRunMessage("SQLite")).toEqual({
      intent: "side-question",
      message: "SQLite",
      explicit: false,
    });
  });
});
