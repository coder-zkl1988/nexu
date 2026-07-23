import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isDeskpetTaskMood,
  resolveDeskpetMood,
  resolveDeskpetTaskDurationMs,
} from "../../apps/desktop/src/lib/deskpet-state";

const REPO_ROOT = resolve(__dirname, "../..");

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(REPO_ROOT, relativePath), "utf8");
}

describe("deskpet state", () => {
  const baseLayers = {
    activityMood: null,
    inactivityMood: null,
    manualMood: null,
    runtimeMood: null,
    taskMood: null,
  } as const;

  it("uses the documented mood priority", () => {
    expect(
      resolveDeskpetMood({
        activityMood: "belly-rub",
        inactivityMood: "rest",
        manualMood: "yawn",
        runtimeMood: "idle",
        taskMood: "lobster-replying",
      }),
    ).toBe("lobster-replying");

    expect(
      resolveDeskpetMood({
        ...baseLayers,
        activityMood: "belly-rub",
        manualMood: "yawn",
        runtimeMood: "idle",
      }),
    ).toBe("yawn");

    expect(
      resolveDeskpetMood({
        ...baseLayers,
        activityMood: "belly-rub",
        inactivityMood: "rest",
        runtimeMood: "idle",
        taskMood: "lobster-replying",
      }),
    ).toBe("lobster-replying");

    expect(
      resolveDeskpetMood({
        ...baseLayers,
        inactivityMood: "rest",
        runtimeMood: "idle",
        taskMood: "lobster-replying",
      }),
    ).toBe("lobster-replying");

    expect(
      resolveDeskpetMood({
        ...baseLayers,
        inactivityMood: "rest",
        runtimeMood: "idle",
      }),
    ).toBe("rest");
    expect(resolveDeskpetMood(baseLayers)).toBe("peek");
  });

  it("recognizes every transient task mood", () => {
    expect(isDeskpetTaskMood("working")).toBe(true);
    expect(isDeskpetTaskMood("lobster-replying")).toBe(true);
    expect(isDeskpetTaskMood("success")).toBe(true);
    expect(isDeskpetTaskMood("error")).toBe(true);
    expect(isDeskpetTaskMood("idle")).toBe(false);
  });

  it("honors and bounds the requested success duration", () => {
    expect(resolveDeskpetTaskDurationMs("success", 500)).toBe(500);
    expect(resolveDeskpetTaskDurationMs("success", 100)).toBe(500);
    expect(resolveDeskpetTaskDurationMs("success", 20_000)).toBe(10_000);
    expect(resolveDeskpetTaskDurationMs("success")).toBe(3600);
  });

  it("provides defaults only for task moods", () => {
    expect(resolveDeskpetTaskDurationMs("working")).toBe(2200);
    expect(resolveDeskpetTaskDurationMs("lobster-replying")).toBe(4800);
    expect(resolveDeskpetTaskDurationMs("error")).toBe(4200);
    expect(resolveDeskpetTaskDurationMs("idle")).toBeNull();
  });
});

describe("deskpet interaction contract", () => {
  const component = readRepoFile(
    "apps/desktop/src/components/desktop-deskpet-app.tsx",
  );
  const preload = readRepoFile("apps/desktop/preload/webview-preload.ts");
  const ipc = readRepoFile("apps/desktop/main/ipc.ts");
  const desktopMain = readRepoFile("apps/desktop/main/index.ts");
  const sharedHost = readRepoFile("apps/desktop/shared/host.ts");
  const sessions = readRepoFile("apps/web/src/pages/sessions.tsx");
  const localChat = readRepoFile("apps/web/src/pages/local-chat.tsx");

  it("opens a compact chat composer from a single click", () => {
    expect(component).toContain("deskpet-chat-composer");
    expect(component).toContain("sendDeskpetMessage");
    expect(component).toContain('aria-label="输入消息"');
    expect(component).toContain('aria-label="发送消息"');
    expect(component).toContain("openChatComposer();");
    expect(component).toContain("triggerPetTease(false);");
    expect(component).toContain(
      "triggerPetTease(false);\n            openChatComposer();",
    );
    expect(component).not.toContain("replyDeskpetCurrentChat");
    expect(component).not.toContain("pauseDeskpetCurrentReply");
    expect(component).not.toContain("openDeskpetCurrentChat");
    expect(component).not.toContain("deskpet-task-followup");
  });

  it("lets direct pet interaction exit a manual mood preview", () => {
    const interactionStart = component.indexOf("const playTemporaryMood");
    const messageStart = component.indexOf(
      "const showTemporaryMessage",
      interactionStart,
    );
    const interactionBlock = component.slice(interactionStart, messageStart);

    expect(interactionBlock).toContain("setManualMood(null);");
  });

  it("dismisses an inactive composer and yields to task states", () => {
    expect(component).toContain(
      "const CHAT_COMPOSER_IDLE_TIMEOUT_MS = 10_000;",
    );
    expect(component).toContain(
      "chatIdleTimerRef.current = window.setTimeout(() => {",
    );

    const taskMoodStart = component.indexOf(
      "if (isDeskpetTaskMood(command.mood))",
    );
    const taskMoodEnd = component.indexOf(
      "setManualMood(null);",
      taskMoodStart,
    );
    const taskMoodBlock = component.slice(taskMoodStart, taskMoodEnd);

    expect(taskMoodBlock).toContain("clearChatIdleTimer();");
    expect(taskMoodBlock).toContain("setIsChatComposerOpen(false);");
    expect(taskMoodBlock).toContain("setMousePassthrough(true);");
  });

  it("keeps deskpet sends headless", () => {
    const sendStart = ipc.indexOf('case "desktop:deskpet-send-message"');
    const startChatStart = ipc.indexOf(
      'case "desktop:deskpet-start-chat"',
      sendStart,
    );
    const registerStart = ipc.indexOf(
      'case "desktop:deskpet-register-current-chat"',
      startChatStart,
    );
    const replyStart = ipc.indexOf(
      'case "desktop:deskpet-reply-current-chat"',
      registerStart,
    );
    const openStart = ipc.indexOf(
      'case "desktop:deskpet-open-current-chat"',
      replyStart,
    );

    expect(sendStart).toBeGreaterThan(-1);
    expect(startChatStart).toBeGreaterThan(sendStart);
    expect(registerStart).toBeGreaterThan(startChatStart);
    expect(replyStart).toBeGreaterThan(registerStart);
    expect(openStart).toBeGreaterThan(replyStart);
    expect(ipc.slice(sendStart, startChatStart)).not.toContain(
      "showPrimaryWindow",
    );
    expect(ipc.slice(startChatStart, registerStart)).not.toContain(
      "showPrimaryWindow",
    );
    expect(ipc.slice(replyStart, openStart)).not.toContain("showPrimaryWindow");
    expect(sharedHost).toContain('"desktop:deskpet-send-message"');
  });

  it("does not restore the main window when the deskpet activates the app", () => {
    const activateStart = desktopMain.indexOf('app.on("activate", () => {');
    const activateEnd = desktopMain.indexOf(
      'app.once("before-quit"',
      activateStart,
    );
    const activateHandler = desktopMain.slice(activateStart, activateEnd);

    expect(activateStart).toBeGreaterThan(-1);
    expect(activateEnd).toBeGreaterThan(activateStart);
    expect(activateHandler).toContain("setImmediate");
    expect(activateHandler).toContain("deskpetWindow.isFocused()");
    expect(activateHandler.indexOf("deskpetWindow.isFocused()")).toBeLessThan(
      activateHandler.indexOf("focusMainWindow();"),
    );
  });

  it("does not infer chat state from global DOM or fetch activity", () => {
    expect(preload).not.toContain("installDeskpetActivityBridge");
    expect(preload).not.toContain("scheduleInputPauseTease");
    expect(preload).not.toContain("window.fetch =");
    expect(preload).not.toContain("MutationObserver");
  });

  it("reports completion from the run final event", () => {
    const finalStart = sessions.indexOf("onFinal: (final) => {");
    const abortedStart = sessions.indexOf("onAborted:", finalStart);
    const finalHandler = sessions.slice(finalStart, abortedStart);

    expect(finalStart).toBeGreaterThan(-1);
    expect(abortedStart).toBeGreaterThan(finalStart);
    expect(finalHandler).toContain('mood: "success"');
    expect(finalHandler).toContain("deskpetReplyPendingRef.current");
    expect(sessions).not.toContain(
      "assistant reply visible; send success immediately",
    );
    expect(sessions).not.toContain("if (pendingReplyText) {");
  });

  it("uses explicit new-chat activity events", () => {
    expect(localChat).toContain("onTyping={handleDeskpetTyping}");
    expect(localChat).toContain('mood: "working"');
    expect(localChat).toContain('mood: "lobster-replying"');
    expect(localChat).toContain('mood: "error"');
  });
});
