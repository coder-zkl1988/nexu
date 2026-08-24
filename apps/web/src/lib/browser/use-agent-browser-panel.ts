import { useEffect } from "react";
import {
  clearAgentBrowserTabRequest,
  requestAgentBrowserTab,
} from "./agent-browser-relay";
import {
  openBrowserPanel,
  releaseAgentBrowserPanelPin,
} from "./browser-panel-store";

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

type DesktopCommand = {
  type?: string;
  tabId?: string;
  url?: string;
  sessionKey?: string;
};

export function useAgentBrowserPanel(): void {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const candidate = (window as Window & { nexuHost?: unknown }).nexuHost;
    if (!candidate || typeof candidate !== "object") return;

    const onDesktopCommand = Reflect.get(candidate, "onDesktopCommand");
    if (typeof onDesktopCommand !== "function") return;

    return onDesktopCommand.call(candidate, (command: DesktopCommand) => {
      if (command.type === "browser:agent-run-ended") {
        releaseAgentBrowserPanelPin();
        // The page stays alive in the main process so the user can read it,
        // but the request must not outlive the run — a standing one is
        // re-adopted by every later panel mount, in every conversation.
        if (command.sessionKey) clearAgentBrowserTabRequest(command.sessionKey);
        return;
      }
      if (command.type !== "browser:agent-opened") return;
      if (!command.tabId || !command.url || !command.sessionKey) return;
      requestAgentBrowserTab(command.tabId, command.url, command.sessionKey);
      // Open the panel *as* the driving session rather than keeping whichever
      // one happened to be showing. The panel is keyed by session key, so this
      // both remounts it with that conversation's own tabs and lets the
      // adoption below recognise the request as its own.
      openBrowserPanel(command.sessionKey, true);
    }) as (() => void) | undefined;
  }, []);
}
