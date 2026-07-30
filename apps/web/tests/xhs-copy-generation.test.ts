import { describe, expect, it } from "vitest";
import {
  buildXhsCopySourceText,
  parseGeneratedXhsCopy,
} from "../src/lib/canvas/xhs-copy-generation";

describe("parseGeneratedXhsCopy", () => {
  it("parses strict JSON and normalizes hashtags", () => {
    expect(
      parseGeneratedXhsCopy(
        JSON.stringify({
          title: "周末松弛感散步",
          content: "沿着河边慢慢走，给自己留一点空白。",
          hashtags: ["#周末", "散步", "散步", " 生活方式 "],
        }),
      ),
    ).toEqual({
      title: "周末松弛感散步",
      content: "沿着河边慢慢走，给自己留一点空白。",
      hashtags: ["周末", "散步", "生活方式"],
    });
  });

  it("accepts a fenced JSON response and caps the title", () => {
    const result = parseGeneratedXhsCopy(`\`\`\`json
{"title":"这是一个明显超过二十个字符的小红书帖子标题需要截断","content":"正文","hashtags":["话题"]}
\`\`\``);

    expect(result.title).toHaveLength(20);
    expect(result.content).toBe("正文");
  });

  it("rejects incomplete content", () => {
    expect(() =>
      parseGeneratedXhsCopy('{"title":"只有标题","hashtags":[]}'),
    ).toThrow("完整的标题和正文");
  });

  it("keeps rewrite context below the API limit and excludes post media metadata", () => {
    const fullPost = {
      title: "已有标题",
      content: `正文${'"\\'.repeat(8_000)}`,
      hashtags: ["#话题"],
      images: [`data:image/png;base64,${"a".repeat(20_000)}`],
      deviceId: "private-device-id",
    };

    const sourceText = buildXhsCopySourceText(fullPost);

    expect(sourceText).toBeDefined();
    expect(sourceText?.length).toBeLessThanOrEqual(8_000);
    expect(sourceText).not.toContain("data:image/png");
    expect(sourceText).not.toContain("private-device-id");
    expect(JSON.parse(sourceText ?? "{}")).toMatchObject({
      title: "已有标题",
      hashtags: ["话题"],
    });
  });
});
