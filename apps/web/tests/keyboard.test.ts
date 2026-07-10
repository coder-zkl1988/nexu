import { isImeComposing } from "@/lib/keyboard";
import { describe, expect, it } from "vitest";

describe("isImeComposing", () => {
  it("is false for a plain keystroke", () => {
    expect(isImeComposing({})).toBe(false);
    expect(isImeComposing({ keyCode: 13, nativeEvent: { keyCode: 13 } })).toBe(
      false,
    );
  });

  it("detects the modern isComposing flag on the event", () => {
    expect(isImeComposing({ isComposing: true })).toBe(true);
  });

  it("detects isComposing on the native event (React synthetic path)", () => {
    // React's synthetic KeyboardEvent does not surface isComposing; only the
    // native event does. This is the case that actually fires in the browser.
    expect(isImeComposing({ nativeEvent: { isComposing: true } })).toBe(true);
  });

  it("detects the legacy keyCode/which 229 on either event", () => {
    expect(isImeComposing({ keyCode: 229 })).toBe(true);
    expect(isImeComposing({ which: 229 })).toBe(true);
    expect(isImeComposing({ nativeEvent: { keyCode: 229 } })).toBe(true);
    expect(isImeComposing({ nativeEvent: { which: 229 } })).toBe(true);
  });

  it("guards the send path: Enter mid-composition must not submit", () => {
    // Mirrors the chat composer's condition.
    const wouldSend = (e: Parameters<typeof isImeComposing>[0]) =>
      !isImeComposing(e);
    expect(wouldSend({ nativeEvent: { isComposing: true } })).toBe(false);
    expect(wouldSend({ nativeEvent: { keyCode: 229 } })).toBe(false);
    expect(
      wouldSend({ nativeEvent: { isComposing: false, keyCode: 13 } }),
    ).toBe(true);
  });
});
