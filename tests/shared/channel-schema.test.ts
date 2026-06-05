import { describe, expect, it } from "vitest";
import {
  channelResponseSchema,
  connectFeishuSchema,
  connectWechatSchema,
  feishuPermissionsSchema,
  feishuPolicySchema,
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

describe("feishuPermissionsSchema", () => {
  it("applies defaults for all fields", () => {
    const p = feishuPermissionsSchema.parse({});
    expect(p.requireMention).toBe(true);
    expect(p.dmPolicy).toBe("open");
    expect(p.groupPolicy).toBe("open");
    expect(p.allowFrom).toEqual([]);
  });
  it("accepts allowlist mode with explicit open_ids", () => {
    const p = feishuPermissionsSchema.parse({
      dmPolicy: "allowlist",
      allowFrom: ["ou_abc", "ou_def"],
    });
    expect(p.allowFrom).toEqual(["ou_abc", "ou_def"]);
  });
  it("rejects unknown policy enum values", () => {
    expect(() =>
      feishuPermissionsSchema.parse({ dmPolicy: "bogus" }),
    ).toThrow();
  });
});

describe("feishuPolicySchema", () => {
  it("accepts the three canonical policy values", () => {
    expect(feishuPolicySchema.parse("open")).toBe("open");
    expect(feishuPolicySchema.parse("allowlist")).toBe("allowlist");
    expect(feishuPolicySchema.parse("disabled")).toBe("disabled");
  });
});

describe("channelResponseSchema feishuPermissions field", () => {
  const base = {
    id: "c1",
    botId: "b1",
    channelType: "feishu" as const,
    accountId: "a1",
    status: "connected" as const,
    teamName: null,
    createdAt: "2026-04-17T00:00:00Z",
    updatedAt: "2026-04-17T00:00:00Z",
  };

  it("accepts feishuPermissions=null", () => {
    const parsed = channelResponseSchema.parse({
      ...base,
      feishuPermissions: null,
    });
    expect(parsed.feishuPermissions).toBeNull();
  });

  it("accepts feishuPermissions=object", () => {
    const parsed = channelResponseSchema.parse({
      ...base,
      feishuPermissions: {
        requireMention: false,
        dmPolicy: "disabled",
        groupPolicy: "open",
        allowFrom: [],
      },
    });
    expect(parsed.feishuPermissions?.requireMention).toBe(false);
    expect(parsed.feishuPermissions?.dmPolicy).toBe("disabled");
  });

  it("accepts feishuPermissions omitted entirely", () => {
    const parsed = channelResponseSchema.parse(base);
    // Either undefined or null is acceptable (field is .nullable().optional())
    expect(parsed.feishuPermissions ?? null).toBeNull();
  });
});
