import { describe, expect, it } from "vitest";
import { expertManifestSchema, installedExpertSchema } from "./expert.js";

describe("expertManifestSchema", () => {
  const valid = {
    schemaVersion: 1,
    slug: "code-reviewer",
    name: "Code Reviewer",
    emoji: "🔍",
    category: "coding",
    description: "Reviews code diffs.",
    tags: ["coding"],
    version: "1.0.0",
    author: "Nexu",
    systemPrompt: "You are a reviewer.",
    modelId: "gpt-4o",
    requiredSkills: ["git-diff-reader"],
    workspaceFiles: { "AGENTS.md": "# Reviewer" },
  };

  it("接受合法的清单", () => {
    expect(expertManifestSchema.parse(valid)).toEqual(valid);
  });

  it("拒绝非法 slug（大写）", () => {
    expect(() =>
      expertManifestSchema.parse({ ...valid, slug: "CodeReviewer" }),
    ).toThrow();
  });

  it("拒绝非 semver 版本号", () => {
    expect(() =>
      expertManifestSchema.parse({ ...valid, version: "1.0" }),
    ).toThrow();
  });

  it("缺省时为 requiredSkills 和 workspaceFiles 赋予默认值", () => {
    const { requiredSkills, workspaceFiles, ...trimmed } = valid;
    const out = expertManifestSchema.parse(trimmed);
    expect(out.requiredSkills).toEqual([]);
    expect(out.workspaceFiles).toEqual({});
  });
});

describe("installedExpertSchema", () => {
  it("要求 slug、version、botId、installedAt", () => {
    expect(
      installedExpertSchema.parse({
        slug: "code-reviewer",
        version: "1.0.0",
        botId: "bot_abc",
        installedAt: "2026-04-16T00:00:00Z",
      }),
    ).toBeDefined();
  });
});
