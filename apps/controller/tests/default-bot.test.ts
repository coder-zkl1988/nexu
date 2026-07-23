import type { BotResponse } from "@nexu/shared";
import { describe, expect, it } from "vitest";
import { resolveDefaultBotFromConfig } from "../src/lib/default-bot.js";

const NOW = "2026-07-23T00:00:00.000Z";

function bot(overrides: Partial<BotResponse> & { id: string }): BotResponse {
  return {
    name: `Bot ${overrides.id}`,
    slug: overrides.id,
    poolId: null,
    status: "active",
    modelId: "anthropic/claude-sonnet-4",
    systemPrompt: null,
    expertSlug: null,
    origin: "user",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("resolveDefaultBotFromConfig", () => {
  it("prefers an explicitly configured active defaultBotId", () => {
    const config = {
      bots: [bot({ id: "alpha" }), bot({ id: "beta" })],
      desktop: { defaultBotId: "beta" },
    };
    expect(resolveDefaultBotFromConfig(config)?.id).toBe("beta");
  });

  it("ignores a stale defaultBotId pointing at a missing bot", () => {
    const config = {
      bots: [bot({ id: "alpha" }), bot({ id: "sys", origin: "system" })],
      desktop: { defaultBotId: "gone" },
    };
    expect(resolveDefaultBotFromConfig(config)?.id).toBe("sys");
  });

  it("ignores a defaultBotId pointing at a paused bot", () => {
    const config = {
      bots: [bot({ id: "alpha" }), bot({ id: "beta", status: "paused" })],
      desktop: { defaultBotId: "beta" },
    };
    expect(resolveDefaultBotFromConfig(config)?.id).toBe("alpha");
  });

  it("falls back to the active system bot when no defaultBotId is set", () => {
    const config = {
      bots: [bot({ id: "alpha" }), bot({ id: "sys", origin: "system" })],
      desktop: {},
    };
    expect(resolveDefaultBotFromConfig(config)?.id).toBe("sys");
  });

  it("skips a paused system bot", () => {
    const config = {
      bots: [
        bot({ id: "alpha" }),
        bot({ id: "sys", origin: "system", status: "paused" }),
      ],
      desktop: {},
    };
    expect(resolveDefaultBotFromConfig(config)?.id).toBe("alpha");
  });

  it("falls back to the first active bot by slug order", () => {
    const config = {
      bots: [
        bot({ id: "zeta", slug: "zeta" }),
        bot({ id: "alpha", slug: "alpha", status: "paused" }),
        bot({ id: "beta", slug: "beta" }),
      ],
      desktop: {},
    };
    expect(resolveDefaultBotFromConfig(config)?.id).toBe("beta");
  });

  it("returns null when there is no active bot", () => {
    const config = {
      bots: [bot({ id: "alpha", status: "paused" })],
      desktop: {},
    };
    expect(resolveDefaultBotFromConfig(config)).toBeNull();
  });
});
