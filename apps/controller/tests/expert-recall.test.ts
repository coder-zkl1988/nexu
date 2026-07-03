import { describe, expect, it } from "vitest";
import {
  recallExperts,
  tokenizeQuery,
} from "../src/services/teams/expert-recall.js";

const CATALOG = [
  {
    slug: "marketing-xiaohongshu-specialist",
    name: "小红书专家",
    description: "小红书内容策略与爆款笔记",
    category: "营销部",
    tags: ["小红书", "种草", "爆款"],
  },
  {
    slug: "finance-financial-analyst",
    name: "财务分析师",
    description: "财务报表与差异分析",
    category: "财务部",
    tags: ["财务", "分析"],
  },
  {
    slug: "engineering-security-engineer",
    name: "安全工程师",
    description: "应用安全审计",
    category: "工程部",
    tags: ["安全", "审计"],
  },
];

describe("tokenizeQuery", () => {
  it("emits latin words and CJK bigrams", () => {
    const tokens = tokenizeQuery("写一篇 seo 笔记");
    expect(tokens).toContain("seo");
    expect(tokens).toContain("写一");
    expect(tokens).toContain("笔记");
  });
});

describe("recallExperts", () => {
  it("ranks matching experts first and drops non-matches", () => {
    const result = recallExperts(CATALOG, "为新品写一篇小红书种草笔记");
    expect(result[0]?.slug).toBe("marketing-xiaohongshu-specialist");
    expect(result.map((r) => r.slug)).not.toContain(
      "engineering-security-engineer",
    );
  });

  it("falls back to the head of the catalog when nothing matches", () => {
    const result = recallExperts(CATALOG, "zzzz", 2);
    expect(result).toHaveLength(2);
    expect(result[0]?.slug).toBe("marketing-xiaohongshu-specialist");
  });

  it("caps at the limit and returns planner-roster shape", () => {
    const result = recallExperts(CATALOG, "财务 分析 安全 审计 小红书", 2);
    expect(result).toHaveLength(2);
    for (const row of result) {
      expect(Object.keys(row).sort()).toEqual(["description", "name", "slug"]);
    }
  });
});
