import { describe, expect, it, vi } from "vitest";
import { broadcastDesktopCommandToTargets } from "../../apps/desktop/main/services/desktop-command-broadcast";

describe("desktop command broadcast", () => {
  it("delivers browser commands to every live renderer, including webviews", () => {
    const shellSend = vi.fn();
    const webviewSend = vi.fn();
    const destroyedSend = vi.fn();
    const command = {
      type: "browser:agent-opened" as const,
      tabId: "agent",
      url: "https://example.com/",
    };

    broadcastDesktopCommandToTargets(
      [
        { isDestroyed: () => false, send: shellSend },
        { isDestroyed: () => false, send: webviewSend },
        { isDestroyed: () => true, send: destroyedSend },
      ],
      command,
    );

    expect(shellSend).toHaveBeenCalledWith("host:desktop-command", command);
    expect(webviewSend).toHaveBeenCalledWith("host:desktop-command", command);
    expect(destroyedSend).not.toHaveBeenCalled();
  });
});
