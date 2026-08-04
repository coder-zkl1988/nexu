import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  captureExternalQuickChatSelection,
  consumeQuickChatSelection,
  resetQuickChatSelectionForTests,
  stageQuickChatSelection,
} from "../../apps/desktop/main/services/quick-chat-selection";

describe("Quick Chat external selection", () => {
  beforeEach(() => {
    resetQuickChatSelectionForTests();
  });

  it("reads the focused macOS accessibility selection without using the clipboard", () => {
    const runAppleScript = vi.fn(() => "  Selected in Safari  \n");

    expect(
      captureExternalQuickChatSelection({
        platform: "darwin",
        runAppleScript,
      }),
    ).toBe("Selected in Safari");
    expect(runAppleScript).toHaveBeenCalledWith(
      expect.stringContaining('attribute "AXSelectedText"'),
    );
  });

  it("falls back to the clipboard when macOS accessibility capture fails", () => {
    expect(
      captureExternalQuickChatSelection({
        platform: "darwin",
        runAppleScript: () => {
          throw new Error("Accessibility unavailable");
        },
        readClipboardText: () => "Copied in Pages",
      }),
    ).toBe("Copied in Pages");
  });

  it("captures a clipboard snapshot on Windows and Linux", () => {
    const readClipboardText = vi.fn(() => "  Copied in Word  ");

    expect(
      captureExternalQuickChatSelection({
        platform: "win32",
        readClipboardText,
      }),
    ).toBe("Copied in Word");
    expect(readClipboardText).toHaveBeenCalledOnce();
  });

  it("consumes a staged selection once and expires stale content", () => {
    stageQuickChatSelection("Selected in Word", 1_000);
    expect(consumeQuickChatSelection(2_000)).toBe("Selected in Word");
    expect(consumeQuickChatSelection(2_001)).toBeNull();

    stageQuickChatSelection("Stale selection", 1_000);
    expect(consumeQuickChatSelection(200_000)).toBeNull();
  });
});
