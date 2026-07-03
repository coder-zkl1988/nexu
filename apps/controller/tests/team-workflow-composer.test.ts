import { describe, expect, it } from "vitest";
import {
  type ComposerCatalogExpert,
  nearestString,
  repairComposedDraft,
} from "../src/services/teams/team-workflow-composer.js";

const CATALOG: ComposerCatalogExpert[] = [
  {
    slug: "marketing-xiaohongshu-specialist",
    name: "小红书策略师",
    description: "爆款策略",
  },
  {
    slug: "marketing-content-creator",
    name: "文案创作",
    description: "内容创作",
  },
  {
    slug: "engineering-technical-writer",
    name: "技术写作",
    description: "文档",
  },
];

function draftJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    name: "测试工作流",
    description: "d",
    inputs: [{ name: "topic", description: "主题", required: true }],
    steps: [
      {
        id: "strategy",
        assigneeSlug: "marketing-xiaohongshu-specialist",
        name: "策略",
        task: "分析 {{topic}}，只输出策略。",
        output: "strategy",
        dependsOn: [],
      },
      {
        id: "write",
        assigneeSlug: "marketing-content-creator",
        name: "写作",
        task: "根据 {{strategy}} 写正文。",
        output: "post",
        dependsOn: ["strategy"],
      },
    ],
    ...overrides,
  });
}

describe("repairComposedDraft", () => {
  it("passes a clean draft through and strips markdown fences", () => {
    const { draft, warnings } = repairComposedDraft(
      `Here you go:\n\`\`\`json\n${draftJson()}\n\`\`\``,
      CATALOG,
    );
    expect(draft.name).toBe("测试工作流");
    expect(draft.steps).toHaveLength(2);
    expect(warnings).toHaveLength(0);
  });

  it("repairs a hallucinated expert slug to the nearest catalog entry", () => {
    const raw = draftJson().replace(
      "marketing-content-creator",
      "marketing-content-writer",
    );
    const { draft, warnings } = repairComposedDraft(raw, CATALOG);
    expect(draft.steps[1]?.assigneeSlug).toBe("marketing-content-creator");
    expect(warnings.some((w) => w.includes("marketing-content-writer"))).toBe(
      true,
    );
  });

  it("repairs a near-miss {{var}} and adds the missing dependsOn edge", () => {
    const raw = JSON.stringify({
      name: "w",
      inputs: [{ name: "topic", required: true }],
      steps: [
        {
          id: "strategy",
          assigneeSlug: "marketing-xiaohongshu-specialist",
          task: "分析 {{topic}}",
          output: "strategy_brief",
          dependsOn: [],
        },
        {
          id: "write",
          assigneeSlug: "marketing-content-creator",
          // near-miss var name AND missing dependsOn — both repairable.
          task: "根据 {{strategy_breif}} 写正文",
          output: "post",
          dependsOn: [],
        },
      ],
    });
    const { draft, warnings } = repairComposedDraft(raw, CATALOG);
    expect(draft.steps[1]?.task).toContain("{{strategy_brief}}");
    expect(draft.steps[1]?.dependsOn).toContain("strategy");
    expect(warnings.length).toBeGreaterThanOrEqual(2);
  });

  it("throws when a slug has no close catalog match", () => {
    const raw = draftJson().replace(
      "marketing-content-creator",
      "quantum-blockchain-guru-9000",
    );
    expect(() => repairComposedDraft(raw, CATALOG)).toThrowError(
      /unknown expert/,
    );
  });

  it("throws on non-JSON model output", () => {
    expect(() => repairComposedDraft("抱歉，我做不到。", CATALOG)).toThrowError(
      /JSON/,
    );
  });
});

describe("nearestString", () => {
  it("prefers substring containment over edit distance", () => {
    expect(
      nearestString(
        "content-creator",
        ["marketing-content-creator", "marketing-content-curator"],
        8,
      ),
    ).toBe("marketing-content-creator");
  });

  it("returns null beyond the distance budget", () => {
    expect(nearestString("zzzzzz", ["abcdef"], 3)).toBeNull();
  });
});
