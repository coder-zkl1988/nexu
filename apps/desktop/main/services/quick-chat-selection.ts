import { execFileSync } from "node:child_process";

const MAX_SELECTED_TEXT_LENGTH = 8_000;
const PENDING_SELECTION_TTL_MS = 2 * 60 * 1_000;

const READ_SELECTED_TEXT_SCRIPT = `
tell application "System Events"
  try
    set frontProcess to first application process whose frontmost is true
    set focusedElement to value of attribute "AXFocusedUIElement" of frontProcess
    set selectedValue to value of attribute "AXSelectedText" of focusedElement
    if selectedValue is missing value then return ""
    return selectedValue as text
  on error
    return ""
  end try
end tell
`;

interface ExternalSelectionCaptureOptions {
  platform?: NodeJS.Platform;
  runAppleScript?: (script: string) => string;
  readClipboardText?: () => string;
}

interface PendingQuickChatSelection {
  text: string;
  capturedAt: number;
}

let pendingSelection: PendingQuickChatSelection | null = null;

function runAppleScript(script: string): string {
  return execFileSync("/usr/bin/osascript", ["-e", script], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 1_500,
  });
}

export function captureExternalQuickChatSelection(
  options: ExternalSelectionCaptureOptions = {},
): string | null {
  if ((options.platform ?? process.platform) === "darwin") {
    try {
      const selectedText = (options.runAppleScript ?? runAppleScript)(
        READ_SELECTED_TEXT_SCRIPT,
      ).trim();
      if (selectedText) {
        return selectedText.slice(0, MAX_SELECTED_TEXT_LENGTH);
      }
    } catch {
      // Accessibility permissions are optional; use the clipboard fallback.
    }
  }

  try {
    const clipboardText = options.readClipboardText?.().trim() ?? "";
    return clipboardText
      ? clipboardText.slice(0, MAX_SELECTED_TEXT_LENGTH)
      : null;
  } catch {
    return null;
  }
}

export function stageQuickChatSelection(
  text: string | null,
  capturedAt = Date.now(),
): void {
  const normalized = text?.trim().slice(0, MAX_SELECTED_TEXT_LENGTH) ?? "";
  pendingSelection = normalized ? { text: normalized, capturedAt } : null;
}

export function consumeQuickChatSelection(now = Date.now()): string | null {
  const snapshot = pendingSelection;
  pendingSelection = null;
  if (!snapshot || now - snapshot.capturedAt > PENDING_SELECTION_TTL_MS) {
    return null;
  }
  return snapshot.text;
}

export function resetQuickChatSelectionForTests(): void {
  pendingSelection = null;
}
