import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { XHSImageGenerationPlaceholders } from "../src/lib/a2ui/custom-components/xhs-image-generation-placeholders";

describe("XHS image generation placeholders", () => {
  it("renders one stable loading slot for every requested image", () => {
    const markup = renderToStaticMarkup(
      <XHSImageGenerationPlaceholders
        slotIds={["request-1", "request-2", "request-3"]}
      />,
    );

    expect(markup.match(/AI 图片生成中/g)).toHaveLength(3);
    expect(markup.match(/animate-spin/g)).toHaveLength(3);
    expect(markup).not.toContain("<img");
  });
});
