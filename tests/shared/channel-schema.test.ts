import { describe, expect, it } from "vitest";
import {
  connectFeishuSchema,
  connectWechatSchema,
  updateChannelBotSchema,
} from "../../packages/shared/src/schemas/channel.js";

describe("connectFeishuSchema", () => {
  it("要求 botId", () => {
    expect(() =>
      connectFeishuSchema.parse({
        appId: "cli_x",
        appSecret: "s",
      }),
    ).toThrow();
  });
  it("带 botId 时解析成功", () => {
    const parsed = connectFeishuSchema.parse({
      appId: "cli_x",
      appSecret: "s",
      botId: "bot_1",
    });
    expect(parsed.botId).toBe("bot_1");
  });
});

describe("connectWechatSchema", () => {
  it("要求 botId", () => {
    expect(() =>
      connectWechatSchema.parse({
        accountId: "wxid_1",
      }),
    ).toThrow();
  });
  it("带 botId 时解析成功", () => {
    const parsed = connectWechatSchema.parse({
      accountId: "wxid_1",
      botId: "bot_1",
    });
    expect(parsed.botId).toBe("bot_1");
  });
});

describe("updateChannelBotSchema", () => {
  it("要求非空 botId", () => {
    expect(() => updateChannelBotSchema.parse({ botId: "" })).toThrow();
    expect(updateChannelBotSchema.parse({ botId: "bot_1" }).botId).toBe(
      "bot_1",
    );
  });
});
