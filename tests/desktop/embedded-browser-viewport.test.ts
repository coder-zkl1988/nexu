import { describe, expect, it } from "vitest";
import { normalizeBrowserZoomFactor } from "../../apps/desktop/main/services/embedded-browser-manager";

describe("embedded browser viewport", () => {
  it("keeps responsive mode at the default zoom", () => {
    expect(normalizeBrowserZoomFactor(undefined)).toBe(1);
    expect(normalizeBrowserZoomFactor(Number.NaN)).toBe(1);
  });

  it("accepts bounded responsive-preview zoom factors", () => {
    expect(normalizeBrowserZoomFactor(0.75)).toBe(0.75);
    expect(normalizeBrowserZoomFactor(0.1)).toBe(0.25);
    expect(normalizeBrowserZoomFactor(2)).toBe(1);
  });
});
