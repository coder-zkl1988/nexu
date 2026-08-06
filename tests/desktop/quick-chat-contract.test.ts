import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getQuickChatContext,
  sendDeskpetMessage,
} from "../../apps/desktop/src/lib/host-api";

const REPO_ROOT = resolve(__dirname, "../..");

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(REPO_ROOT, relativePath), "utf8");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Quick Chat contract", () => {
  it("forwards a screenshot attachment through the typed host bridge", async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true, mode: "started" });
    vi.stubGlobal("window", { nexuHost: { invoke } });
    const screenshot = {
      type: "image" as const,
      content: "cG5n",
      metadata: {
        mimeType: "image/png" as const,
        filename: "quick-chat.png",
        size: 3,
      },
    };

    await sendDeskpetMessage("Inspect this screenshot", [screenshot]);

    expect(invoke).toHaveBeenCalledWith("desktop:deskpet-send-message", {
      text: "Inspect this screenshot",
      attachments: [screenshot],
    });
  });

  it("requests selected text and screenshots independently", async () => {
    const invoke = vi.fn().mockResolvedValue({
      selectedText: "Selected text",
      selectedTextSource: "selection",
      screenshot: null,
    });
    vi.stubGlobal("window", { nexuHost: { invoke } });

    await getQuickChatContext({
      includeSelectedText: true,
      includeScreenshot: false,
    });

    expect(invoke).toHaveBeenCalledWith("desktop:get-quick-chat-context", {
      includeSelectedText: true,
      includeScreenshot: false,
    });
  });

  it("keeps menu, tray, and global-shortcut entry points on one composer command", () => {
    const desktopMain = readRepoFile("apps/desktop/main/index.ts");
    const commandOccurrences =
      desktopMain.match(/openDesktopQuickChat\(\)/gu) ?? [];

    expect(desktopMain).toContain(
      'accelerator: "CommandOrControl+Shift+Space"',
    );
    expect(desktopMain).toContain(
      'globalShortcut.register("CommandOrControl+Shift+Space"',
    );
    expect(desktopMain).toContain('type: "deskpet:open-composer"');
    expect(commandOccurrences.length).toBeGreaterThanOrEqual(4);
  });

  it("captures external context before every Quick Chat entry focuses", () => {
    const desktopMain = readRepoFile("apps/desktop/main/index.ts");
    const openQuickChat = desktopMain.slice(
      desktopMain.indexOf("function openDesktopQuickChat()"),
      desktopMain.indexOf("function applyDeskpetPreference"),
    );

    expect(
      openQuickChat.indexOf("captureExternalQuickChatSelection"),
    ).toBeGreaterThanOrEqual(0);
    expect(
      openQuickChat.indexOf("captureExternalQuickChatSelection"),
    ).toBeLessThan(openQuickChat.indexOf("createDeskpetWindow()"));
    expect(openQuickChat).toContain('clipboard.readText("selection")');
    expect(openQuickChat).toContain("clipboard.readText()");
    expect(readRepoFile("apps/desktop/main/ipc.ts")).toContain(
      "consumeQuickChatSelection()",
    );
  });

  it("only exposes captured context to the active Deskpet renderer", () => {
    const ipc = readRepoFile("apps/desktop/main/ipc.ts");
    const contextCase = ipc.slice(
      ipc.indexOf('case "desktop:get-quick-chat-context"'),
      ipc.indexOf('case "desktop:report-error"'),
    );
    const desktopMain = readRepoFile("apps/desktop/main/index.ts");

    expect(contextCase).toContain(
      "_event.sender.id !== getQuickChatContextSenderId?.()",
    );
    expect(contextCase.indexOf("getQuickChatContextSenderId")).toBeLessThan(
      contextCase.indexOf("return getQuickChatContext"),
    );
    expect(desktopMain).toContain("deskpetWindow.webContents.id");
  });

  it("does not write external URL credentials or OAuth parameters to logs", () => {
    const ipc = readRepoFile("apps/desktop/main/ipc.ts");
    const externalOpenCase = ipc.slice(
      ipc.indexOf('case "shell:open-external"'),
      ipc.indexOf('case "desktop:pick-attachments"'),
    );

    expect(externalOpenCase).toContain("shell.openExternal(typedPayload.url)");
    expect(externalOpenCase).not.toMatch(
      /console\.(?:info|log|warn|error)\([^)]*typedPayload\.url/su,
    );
  });
});
