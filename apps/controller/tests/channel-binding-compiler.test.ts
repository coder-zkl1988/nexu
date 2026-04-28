import type { ChannelResponse, FeishuPermissions } from "@nexu/shared";
import { describe, expect, it } from "vitest";
import { compileChannelsConfig } from "../src/lib/channel-binding-compiler.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const now = new Date().toISOString();

function makeFeishuChannel(overrides: {
  accountId: string;
  feishuPermissions: FeishuPermissions | null;
  id?: string;
  status?: "connected" | "disconnected";
}): ChannelResponse {
  return {
    id: overrides.id ?? `ch-${overrides.accountId}`,
    botId: "bot-1",
    channelType: "feishu",
    accountId: overrides.accountId,
    status: overrides.status ?? "connected",
    teamName: null,
    appId: null,
    botUserId: null,
    createdAt: now,
    updatedAt: now,
    feishuPermissions: overrides.feishuPermissions,
  } as ChannelResponse;
}

function makeSecretsFor(...accountIds: string[]): Record<string, string> {
  const secrets: Record<string, string> = {};
  for (const accountId of accountIds) {
    secrets[`channel:ch-${accountId}:appId`] = `app-${accountId}`;
    secrets[`channel:ch-${accountId}:appSecret`] = `secret-${accountId}`;
  }
  return secrets;
}

// ---------------------------------------------------------------------------
// feishuPermissions compilation
// ---------------------------------------------------------------------------

describe("feishu permissions compilation", () => {
  it("feishuPermissions=null → historical defaults emitted at account level", () => {
    const out = compileChannelsConfig({
      channels: [
        makeFeishuChannel({ accountId: "a1", feishuPermissions: null }),
      ],
      secrets: makeSecretsFor("a1"),
      controllerBaseUrl: "http://127.0.0.1:3010",
    });

    expect(out.feishu?.accounts.a1.dmPolicy).toBe("open");
    expect(out.feishu?.accounts.a1.groupPolicy).toBe("open");
    expect(out.feishu?.accounts.a1.allowFrom).toEqual(["*"]);
    expect(out.feishu?.accounts.a1.requireMention).toBeUndefined();
    // Top-level fallback must remain unchanged (Plan C safety net)
    expect(out.feishu?.requireMention).toBe(true);
    expect(out.feishu?.dmPolicy).toBe("open");
    expect(out.feishu?.groupPolicy).toBe("open");
    expect(out.feishu?.allowFrom).toEqual(["*"]);
  });

  it("non-null feishuPermissions → emits values to account level", () => {
    const out = compileChannelsConfig({
      channels: [
        makeFeishuChannel({
          accountId: "a1",
          feishuPermissions: {
            requireMention: false,
            dmPolicy: "allowlist",
            groupPolicy: "open",
            allowFrom: ["ou_alice", "ou_bob"],
          },
        }),
      ],
      secrets: makeSecretsFor("a1"),
      controllerBaseUrl: "http://127.0.0.1:3010",
    });

    expect(out.feishu?.accounts.a1.requireMention).toBe(false);
    expect(out.feishu?.accounts.a1.dmPolicy).toBe("allowlist");
    expect(out.feishu?.accounts.a1.groupPolicy).toBe("open");
    expect(out.feishu?.accounts.a1.allowFrom).toEqual(["ou_alice", "ou_bob"]);
  });

  it("allowFrom=[] + allowlist mode → preserves [] (deny all)", () => {
    const out = compileChannelsConfig({
      channels: [
        makeFeishuChannel({
          accountId: "a1",
          feishuPermissions: {
            requireMention: true,
            dmPolicy: "allowlist",
            groupPolicy: "open",
            allowFrom: [],
          },
        }),
      ],
      secrets: makeSecretsFor("a1"),
      controllerBaseUrl: "http://127.0.0.1:3010",
    });

    expect(out.feishu?.accounts.a1.allowFrom).toEqual([]);
  });

  it("allowFrom=[] + groupPolicy=allowlist → preserves [] (deny all)", () => {
    const out = compileChannelsConfig({
      channels: [
        makeFeishuChannel({
          accountId: "a1",
          feishuPermissions: {
            requireMention: true,
            dmPolicy: "open",
            groupPolicy: "allowlist",
            allowFrom: [],
          },
        }),
      ],
      secrets: makeSecretsFor("a1"),
      controllerBaseUrl: "http://127.0.0.1:3010",
    });

    expect(out.feishu?.accounts.a1.allowFrom).toEqual([]);
  });

  it("allowFrom=[] + both policies open → emits ['*']", () => {
    const out = compileChannelsConfig({
      channels: [
        makeFeishuChannel({
          accountId: "a1",
          feishuPermissions: {
            requireMention: true,
            dmPolicy: "open",
            groupPolicy: "open",
            allowFrom: [],
          },
        }),
      ],
      secrets: makeSecretsFor("a1"),
      controllerBaseUrl: "http://127.0.0.1:3010",
    });

    expect(out.feishu?.accounts.a1.allowFrom).toEqual(["*"]);
    expect(out.feishu?.accounts.a1.requireMention).toBe(true);
  });

  it("two feishu instances with different permissions don't interfere", () => {
    const out = compileChannelsConfig({
      channels: [
        makeFeishuChannel({
          accountId: "a1",
          feishuPermissions: {
            requireMention: false,
            dmPolicy: "open",
            groupPolicy: "open",
            allowFrom: [],
          },
        }),
        makeFeishuChannel({ accountId: "a2", feishuPermissions: null }),
      ],
      secrets: makeSecretsFor("a1", "a2"),
      controllerBaseUrl: "http://127.0.0.1:3010",
    });

    expect(out.feishu?.accounts.a1.requireMention).toBe(false);
    expect(out.feishu?.accounts.a1.allowFrom).toEqual(["*"]);
    expect(out.feishu?.accounts.a2.requireMention).toBeUndefined();
    expect(out.feishu?.accounts.a2.allowFrom).toEqual(["*"]);
  });
});
