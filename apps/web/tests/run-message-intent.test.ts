import { describe, expect, it } from "vitest";
import { classifyExplicitRunMessage } from "../src/lib/chat/run-message-intent";

describe("classifyExplicitRunMessage", () => {
  it("supports explicit BTW and Steer commands", () => {
    expect(classifyExplicitRunMessage("/btw 现在完成了哪些步骤？")).toEqual({
      intent: "side-question",
      message: "现在完成了哪些步骤？",
      explicit: true,
    });
    expect(classifyExplicitRunMessage("/side 当前状态？")).toEqual({
      intent: "side-question",
      message: "当前状态？",
      explicit: true,
    });
    expect(classifyExplicitRunMessage("/steer 只跑相关测试")).toEqual({
      intent: "steer",
      message: "只跑相关测试",
      explicit: true,
    });
    expect(classifyExplicitRunMessage("/tell focus on controller")).toEqual({
      intent: "steer",
      message: "focus on controller",
      explicit: true,
    });
    expect(classifyExplicitRunMessage("／steer：立即停止扫描")).toEqual({
      intent: "steer",
      message: "立即停止扫描",
      explicit: true,
    });
    expect(classifyExplicitRunMessage("、steer 只总结现有结果")).toEqual({
      intent: "steer",
      message: "只总结现有结果",
      explicit: true,
    });
  });

  it("only aborts on high-confidence stop messages", () => {
    expect(classifyExplicitRunMessage("停止当前任务")?.intent).toBe("abort");
    expect(classifyExplicitRunMessage("先暂停一下")?.intent).toBe("abort");
    expect(classifyExplicitRunMessage("stop current task")?.intent).toBe(
      "abort",
    );
    expect(classifyExplicitRunMessage("为什么停止了？")).toBeNull();
    expect(classifyExplicitRunMessage("现在可以停止吗？")).toBeNull();
    expect(classifyExplicitRunMessage("停止扫描，直接总结")).toBeNull();
  });

  it("leaves natural language to the model classifier", () => {
    expect(classifyExplicitRunMessage("SQLite")).toBeNull();
    expect(classifyExplicitRunMessage("Use SQLite instead")).toBeNull();
    expect(classifyExplicitRunMessage("¿Cómo va la tarea?")).toBeNull();
  });
});
