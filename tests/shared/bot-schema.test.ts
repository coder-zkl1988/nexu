import { describe, expect, it } from "vitest";
import {
  botResponseSchema,
  createBotSchema,
} from "../../packages/shared/src/schemas/bot.js";

describe("createBotSchema expertSlug field", () => {
  it("accepts optional expertSlug when provided", () => {
    const parsed = createBotSchema.parse({
      name: "Reviewer Bot",
      slug: "reviewer-bot",
      expertSlug: "code-reviewer",
    });
    expect(parsed.expertSlug).toBe("code-reviewer");
  });

  it("accepts missing expertSlug (optional)", () => {
    const parsed = createBotSchema.parse({
      name: "Plain",
      slug: "plain",
    });
    expect(parsed.expertSlug).toBeUndefined();
  });

  it("accepts null expertSlug", () => {
    const parsed = createBotSchema.parse({
      name: "Plain",
      slug: "plain",
      expertSlug: null,
    });
    expect(parsed.expertSlug).toBeNull();
  });

  it("rejects invalid expertSlug (uppercase)", () => {
    expect(() =>
      createBotSchema.parse({
        name: "Plain",
        slug: "plain",
        expertSlug: "CodeReviewer",
      }),
    ).toThrow();
  });
});

describe("botResponseSchema expertSlug field", () => {
  const baseBot = {
    id: "b1",
    name: "Reviewer",
    slug: "reviewer",
    poolId: null,
    status: "active" as const,
    modelId: "gpt-4o",
    systemPrompt: null,
    createdAt: "2026-04-17T00:00:00Z",
    updatedAt: "2026-04-17T00:00:00Z",
  };

  it("accepts explicit null expertSlug", () => {
    const parsed = botResponseSchema.parse({
      ...baseBot,
      expertSlug: null,
    });
    expect(parsed.expertSlug).toBeNull();
  });

  it("accepts a string expertSlug", () => {
    const parsed = botResponseSchema.parse({
      ...baseBot,
      expertSlug: "code-reviewer",
    });
    expect(parsed.expertSlug).toBe("code-reviewer");
  });

  it("defaults expertSlug to null when missing (backward-compat for persisted configs)", () => {
    const parsed = botResponseSchema.parse(baseBot);
    expect(parsed.expertSlug).toBeNull();
  });
});
