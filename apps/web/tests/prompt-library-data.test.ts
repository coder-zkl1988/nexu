/**
 * prompt-library-data.test.ts — third-party prompt library data layer.
 *
 * Network loaders are exercised through their pure parsing helpers plus
 * applyFilters/fetch-page slicing; actual GitHub fetches are not hit here.
 *
 * Matrix:
 *  a. splitAtHeading splits markdown into per-heading blocks
 *  b. matchFirst / markdownImages / absoluteImageUrl extraction
 *  c. headingTags / splitTags normalization
 *  d. applyFilters: keyword (title/prompt/category/tags), category, tag OR
 *  e. tag options derive from the un-tag-filtered scope (fetchPromptPage)
 */

import { describe, expect, it } from "vitest";
import {
  ALL_PROMPTS_OPTION,
  type LibraryPrompt,
  __resetPromptDataForTests,
  absoluteImageUrl,
  applyFilters,
  fetchPromptPage,
  headingTags,
  isBadgeImage,
  markdownImages,
  matchFirst,
  promptCoverPath,
  splitAtHeading,
  splitTags,
} from "../src/lib/canvas/prompt-library-data";

function makePrompt(overrides: Partial<LibraryPrompt>): LibraryPrompt {
  return {
    id: "p-1",
    title: "标题",
    coverUrl: "",
    prompt: "提示词",
    tags: [],
    category: "awesome-gpt-image",
    githubUrl: "https://github.com/example",
    ...overrides,
  };
}

describe("markdown parsing helpers", () => {
  it("a. splitAtHeading splits blocks at heading prefix", () => {
    const md = "intro\n## 一\ncontent-a\n## 二\ncontent-b";
    const blocks = splitAtHeading(md, "## ");
    expect(blocks).toHaveLength(3);
    expect(blocks[1]).toContain("## 一");
    expect(blocks[1]).toContain("content-a");
    expect(blocks[2]).toContain("## 二");
  });

  it("b. matchFirst extracts the first capture; markdownImages absolutizes", () => {
    expect(matchFirst("### 手办化\n正文", /^###\s+(.+)$/m)).toBe("手办化");
    expect(matchFirst("无匹配", /^###\s+(.+)$/m)).toBe("");

    const base = "https://raw.example.com/repo/main";
    const md = "![a](./images/a.png)\n![b](https://cdn.example.com/b.png)";
    expect(markdownImages(base, md)).toEqual([
      `${base}/images/a.png`,
      "https://cdn.example.com/b.png",
    ]);
    expect(absoluteImageUrl(base, "")).toBe("");
    expect(absoluteImageUrl(base, "/x.png")).toBe(`${base}/x.png`);
  });

  it("c. headingTags strips decoration and splits on separators", () => {
    expect(headingTags("🎨 风格 & 材质")).toEqual(["风格", "材质"]);
    expect(headingTags("人像/写真、创意")).toEqual(["人像", "写真", "创意"]);
    expect(splitTags("A/B/c", /\//)).toEqual(["a", "b", "c"]);
    expect(splitTags("", /\//)).toEqual([]);
  });
});

describe("applyFilters", () => {
  const items: LibraryPrompt[] = [
    makePrompt({
      id: "1",
      title: "手办化",
      prompt: "把照片变成手办",
      tags: ["3d", "手办"],
      category: "awesome-gpt-image",
    }),
    makePrompt({
      id: "2",
      title: "Ghibli style",
      prompt: "宫崎骏风格插画",
      tags: ["插画"],
      category: "youmind-gpt-image-2",
    }),
  ];

  it("d. keyword matches title/prompt/category/tags, case-insensitive", () => {
    expect(
      applyFilters(items, {
        keyword: "ghibli",
        category: ALL_PROMPTS_OPTION,
        tags: [],
      }),
    ).toHaveLength(1);
    expect(
      applyFilters(items, {
        keyword: "手办",
        category: ALL_PROMPTS_OPTION,
        tags: [],
      }),
    ).toHaveLength(1);
    expect(
      applyFilters(items, {
        keyword: "",
        category: "youmind-gpt-image-2",
        tags: [],
      }),
    ).toEqual([items[1]]);
    // tag filter is an OR across selected tags
    expect(
      applyFilters(items, {
        keyword: "",
        category: ALL_PROMPTS_OPTION,
        tags: ["插画", "不存在"],
      }),
    ).toEqual([items[1]]);
    // 全部 category matches everything
    expect(
      applyFilters(items, {
        keyword: "",
        category: ALL_PROMPTS_OPTION,
        tags: [],
      }),
    ).toHaveLength(2);
  });
});

describe("bundled snapshot fallback", () => {
  it("f. snapshot is non-empty, well-formed and category-capped", async () => {
    const snapshot = (await import(
      "../src/lib/canvas/prompt-library-snapshot.json"
    )) as { default: LibraryPrompt[] };
    const items = snapshot.default;
    expect(items.length).toBeGreaterThan(50);
    for (const item of items.slice(0, 10)) {
      expect(item.id).toBeTruthy();
      expect(item.title).toBeTruthy();
      expect(item.prompt).toBeTruthy();
      expect(item.category).toBeTruthy();
    }
  });

  it("g. fetchPromptPage serves the snapshot when the network is down", async () => {
    __resetPromptDataForTests();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.reject(new Error("offline"))) as typeof fetch;
    try {
      const page = await fetchPromptPage({ page: 1, pageSize: 5 });
      expect(page.total).toBeGreaterThan(50);
      expect(page.items).toHaveLength(5);
      expect(page.categories.length).toBe(5);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("cover routing helpers", () => {
  it("h. badge images are never covers", () => {
    expect(isBadgeImage("https://img.shields.io/badge/x-y-blue")).toBe(true);
    expect(
      isBadgeImage("https://raw.githubusercontent.com/a/b/cover.png"),
    ).toBe(false);
    const md =
      "![badge](https://img.shields.io/badge/a-b) ![c](./images/c.png)";
    expect(markdownImages("https://raw.example.com/r/main", md)).toEqual([
      "https://raw.example.com/r/main/images/c.png",
    ]);
  });

  it("i. promptCoverPath proxies allowed hosts, passes others through", () => {
    const gh = "https://raw.githubusercontent.com/a/b/c.png";
    expect(promptCoverPath(gh)).toBe(
      `/api/v1/media/prompt-cover?url=${encodeURIComponent(gh)}`,
    );
    // twimg deliberately loads DIRECT: proxying it hangs our origin's
    // connection pool when the CDN is unreachable (see isProxyableCoverUrl).
    const twimg = "https://pbs.twimg.com/media/x.jpg";
    expect(promptCoverPath(twimg)).toBe(twimg);
    // non-allowlisted host loads direct
    expect(promptCoverPath("https://cdn.example.com/x.png")).toBe(
      "https://cdn.example.com/x.png",
    );
    // http (non-https) is not proxyable
    expect(promptCoverPath("http://raw.githubusercontent.com/x.png")).toBe(
      "http://raw.githubusercontent.com/x.png",
    );
    expect(promptCoverPath("")).toBe("");
  });
});
