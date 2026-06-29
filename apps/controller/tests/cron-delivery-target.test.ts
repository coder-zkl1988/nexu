import { describe, expect, it } from "vitest";
import { deliveryTargetFromSessionKey } from "../src/services/openclaw-cron-gateway.js";

describe("deliveryTargetFromSessionKey", () => {
  it("maps a Feishu group session to chat:<chatId>", () => {
    expect(
      deliveryTargetFromSessionKey(
        "agent:bot-1:feishu:group:oc_50566c196581e83d54c632e91c91f0fd",
      ),
    ).toBe("chat:oc_50566c196581e83d54c632e91c91f0fd");
  });

  it("maps a direct session to user:<openId>", () => {
    expect(
      deliveryTargetFromSessionKey(
        "agent:bot-1:direct:ou_d9208062b4d22e1616088060332e7ffe",
      ),
    ).toBe("user:ou_d9208062b4d22e1616088060332e7ffe");
  });

  it("maps a WeChat direct session to the raw @im.wechat id (no prefix)", () => {
    expect(
      deliveryTargetFromSessionKey(
        "agent:bot-1:direct:o9cq80w-icturnjuzkd3sruzos9a@im.wechat",
      ),
    ).toBe("o9cq80w-icturnjuzkd3sruzos9a@im.wechat");
  });

  it("returns null for webchat / cron / schedule sessions (no peer)", () => {
    expect(deliveryTargetFromSessionKey("agent:bot-1:main")).toBeNull();
    expect(deliveryTargetFromSessionKey("agent:bot-1:cron:abc-123")).toBeNull();
    expect(
      deliveryTargetFromSessionKey("agent:bot-1:schedule-abc-123"),
    ).toBeNull();
  });
});
