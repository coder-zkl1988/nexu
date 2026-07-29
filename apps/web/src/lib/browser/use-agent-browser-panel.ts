import { useEffect } from "react";
import { requestAgentBrowserTab } from "./agent-browser-relay";
import { getBrowserPanelState, openBrowserPanel } from "./browser-panel-store";

/**
 * Raises the browser panel when the agent opens a page.
 *
 * The main process executes browser commands and announces an `open` here. It
 * does not wait for this: the page is already loading by the time the event
 * arrives, and an agent whose panel cannot be shown right now still makes
 * progress. This is what makes the work visible, not what authorizes it.
 *
 * Mounted at the app root rather than the workspace layout so it also fires
 * for conversations held somewhere else, webchat included.
 */

type DesktopCommand = { type?: string; tabId?: string; url?: string };

// Used only when the agent opens a page before any conversation has claimed
// the panel; artifact lookups keyed by it simply come back empty.
const FALLBACK_SESSION_KEY = "agent";

export function useAgentBrowserPanel(): void {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const candidate = (window as Window & { nexuHost?: unknown }).nexuHost;
    if (!candidate || typeof candidate !== "object") return;

    const onDesktopCommand = Reflect.get(candidate, "onDesktopCommand");
    if (typeof onDesktopCommand !== "function") return;

    return onDesktopCommand.call(candidate, (command: DesktopCommand) => {
      if (command.type !== "browser:agent-opened") return;
      if (!command.tabId || !command.url) return;
      requestAgentBrowserTab(command.tabId, command.url);
      openBrowserPanel(
        getBrowserPanelState().sessionKey ?? FALLBACK_SESSION_KEY,
        true,
      );
    }) as (() => void) | undefined;
  }, []);
}
