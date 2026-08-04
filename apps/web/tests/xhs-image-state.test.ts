import { describe, expect, it } from "vitest";
import { mergeXhsImages } from "../src/lib/a2ui/custom-components/xhs-image-state";

describe("mergeXhsImages", () => {
  it("preserves local uploads while adding an agent-generated image", () => {
    expect(
      mergeXhsImages(
        ["local-upload.png", "existing-cover.png"],
        ["existing-cover.png", "generated-cover.png"],
      ),
    ).toEqual([
      "local-upload.png",
      "existing-cover.png",
      "generated-cover.png",
    ]);
  });
});
