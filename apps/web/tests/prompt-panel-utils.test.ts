/**
 * prompt-panel-utils.test.ts
 *
 * TDD (W2.4): tests for pure helpers in prompt-panel-utils.ts.
 * Plain Node env — no jsdom, no DOM events.
 */

import { describe, expect, it } from "vitest";
import {
  mentionQueryAt,
  servablePathFromUrl,
  upstreamSummary,
  usableReferencePaths,
} from "../src/lib/canvas/prompt-panel-utils";

describe("servablePathFromUrl", () => {
  it("returns decoded path param for a valid state-file URL", () => {
    const url =
      "/api/v1/media/state-file?path=%2Fhome%2Fuser%2F.nexu%2Fimg%2Fabc.png";
    expect(servablePathFromUrl(url)).toBe("/home/user/.nexu/img/abc.png");
  });

  it("returns decoded path param for an absolute-origin state-file URL", () => {
    const url =
      "http://localhost:3000/api/v1/media/state-file?path=%2Fhome%2Fimg.png";
    expect(servablePathFromUrl(url)).toBe("/home/img.png");
  });

  it("returns path with encoded chars decoded (spaces, etc.)", () => {
    const url = "/api/v1/media/state-file?path=%2Ffoo%20bar%2Fimage.png";
    expect(servablePathFromUrl(url)).toBe("/foo bar/image.png");
  });

  it("returns null for a dataURL", () => {
    const url = "data:image/png;base64,abc123";
    expect(servablePathFromUrl(url)).toBeNull();
  });

  it("returns null for a foreign URL that is not state-file", () => {
    const url = "http://example.com/some/image.png";
    expect(servablePathFromUrl(url)).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(servablePathFromUrl("")).toBeNull();
  });
});

describe("usableReferencePaths", () => {
  it("returns servable paths from a mixed list, dropping dataURLs", () => {
    const images = [
      "data:image/png;base64,abc",
      "/api/v1/media/state-file?path=%2Fimg%2Fa.png",
      "data:image/jpeg;base64,def",
      "/api/v1/media/state-file?path=%2Fimg%2Fb.png",
    ];
    expect(usableReferencePaths(images)).toEqual(["/img/a.png", "/img/b.png"]);
  });

  it("caps at 4 items", () => {
    const images = [
      "/api/v1/media/state-file?path=%2Fimg%2F1.png",
      "/api/v1/media/state-file?path=%2Fimg%2F2.png",
      "/api/v1/media/state-file?path=%2Fimg%2F3.png",
      "/api/v1/media/state-file?path=%2Fimg%2F4.png",
      "/api/v1/media/state-file?path=%2Fimg%2F5.png",
    ];
    const result = usableReferencePaths(images);
    expect(result).toHaveLength(4);
    expect(result[0]).toBe("/img/1.png");
    expect(result[3]).toBe("/img/4.png");
  });

  it("returns empty array for all dataURLs", () => {
    const images = ["data:image/png;base64,a", "data:image/png;base64,b"];
    expect(usableReferencePaths(images)).toEqual([]);
  });

  it("returns empty array for empty input", () => {
    expect(usableReferencePaths([])).toEqual([]);
  });
});

describe("mentionQueryAt", () => {
  it("returns query when @ is at start of text and caret is at end", () => {
    // "@foo" with caret at 4
    const result = mentionQueryAt("@foo", 4);
    expect(result).toEqual({ query: "foo", start: 0 });
  });

  it("returns query when @ appears after a space mid-text", () => {
    // "hello @world" — @ at index 6, caret at 12
    const result = mentionQueryAt("hello @world", 12);
    expect(result).toEqual({ query: "world", start: 6 });
  });

  it("returns null when there is no @ before the caret", () => {
    const result = mentionQueryAt("hello world", 11);
    expect(result).toBeNull();
  });

  it("returns null when @ is followed by whitespace before caret (inactive mention)", () => {
    // "@ something" — whitespace between @ and caret position (3 = 'e')
    const result = mentionQueryAt("@ something", 3);
    expect(result).toBeNull();
  });

  it("returns query with caret mid-token", () => {
    // "@fo" — caret at 3 (mid-way through "@foo")
    const result = mentionQueryAt("@foo bar", 3);
    expect(result).toEqual({ query: "fo", start: 0 });
  });

  it("returns null when caret is before the @", () => {
    const result = mentionQueryAt("@foo", 0);
    // caret at 0, before the @, so no active token
    expect(result).toBeNull();
  });

  it("returns query when caret is right after @", () => {
    // "@" — caret at 1, query is empty
    const result = mentionQueryAt("@", 1);
    expect(result).toEqual({ query: "", start: 0 });
  });

  it("picks the LAST @ before caret when multiple @ exist", () => {
    // "hello @alice @bo" — caret at 16, last @ at 13
    const result = mentionQueryAt("hello @alice @bo", 16);
    expect(result).toEqual({ query: "bo", start: 13 });
  });
});

describe("upstreamSummary", () => {
  it("returns 无上游输入 for empty upstream", () => {
    const result = upstreamSummary(
      { prompts: [], images: [], videos: [], audios: [] },
      0,
    );
    expect(result).toBe("无上游输入");
  });

  it("all groups populated: shows all with correct counts", () => {
    const result = upstreamSummary(
      {
        prompts: ["a", "b"],
        images: ["img1", "img2", "img3"],
        videos: ["vid1"],
        audios: ["aud1", "aud2"],
      },
      3, // usable == total images → no parenthetical
    );
    // usableImages === images.length → no 可用 sub-count
    expect(result).toBe("文本 2 · 参考图 3 · 视频 1 · 音频 2");
  });

  it("shows 可用 count only when it differs from total images", () => {
    const result = upstreamSummary(
      { prompts: [], images: ["img1", "img2", "img3"], videos: [], audios: [] },
      1, // only 1 usable out of 3
    );
    expect(result).toBe("参考图 3（可用 1）");
  });

  it("omits zero groups", () => {
    const result = upstreamSummary(
      { prompts: ["hello"], images: [], videos: ["v"], audios: [] },
      0,
    );
    expect(result).toBe("文本 1 · 视频 1");
  });

  it("single group only: text only", () => {
    const result = upstreamSummary(
      { prompts: ["a", "b", "c"], images: [], videos: [], audios: [] },
      0,
    );
    expect(result).toBe("文本 3");
  });

  it("images only, usable equals total (no parenthetical)", () => {
    const result = upstreamSummary(
      { prompts: [], images: ["a", "b"], videos: [], audios: [] },
      2,
    );
    expect(result).toBe("参考图 2");
  });
});
