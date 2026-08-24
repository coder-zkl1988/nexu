import { describe, expect, it } from "vitest";
import { nexuConfigSchema } from "../src/store/schemas.js";

// Before per-bot binding existed, changing the global default rewrote every
// bot's modelId — that was the only way to make the setting take effect. So a
// stored bot whose model equals the current default was never a deliberate
// choice, and leaving it as an explicit binding would freeze it at today's
// value and silently stop it tracking the default forever.

const now = new Date().toISOString();

function parseWith(
  bots: Array<{ modelId: string | null }>,
  defaultModelId: string,
) {
  return nexuConfigSchema.parse({
    $schema: "https://nexu.io/config.json",
    schemaVersion: 1,
    bots: bots.map((bot, index) => ({
      id: `bot-${index}`,
      name: `Bot ${index}`,
      slug: `bot-${index}`,
      poolId: null,
      status: "active",
      modelId: bot.modelId,
      systemPrompt: null,
      createdAt: now,
      updatedAt: now,
    })),
    runtime: {
      gateway: { port: 18789, bind: "loopback", authMode: "token" },
      defaultModelId,
    },
  });
}

describe("per-bot model binding migration", () => {
  it("resets a bot that merely mirrors the current default to follow it", () => {
    const config = parseWith(
      [{ modelId: "anthropic/claude-sonnet-4" }],
      "anthropic/claude-sonnet-4",
    );

    expect(config.bots[0]?.modelId).toBeNull();
  });

  it("leaves a bot pointed at a different model alone", () => {
    const config = parseWith(
      [{ modelId: "openai/gpt-4.1" }],
      "anthropic/claude-sonnet-4",
    );

    // This one cannot have come from the old rewrite-everything path, so it is
    // a real choice and must survive.
    expect(config.bots[0]?.modelId).toBe("openai/gpt-4.1");
  });

  it("treats the old empty-string marker as following the default", () => {
    const config = parseWith([{ modelId: "" }], "anthropic/claude-sonnet-4");

    // "" used to mean "no model" and compiled into an agent with an unknown
    // model; null is the single way to say "follow the default" now.
    expect(config.bots[0]?.modelId).toBeNull();
  });

  it("keeps an already-null binding null", () => {
    const config = parseWith([{ modelId: null }], "anthropic/claude-sonnet-4");

    expect(config.bots[0]?.modelId).toBeNull();
  });
});
