import type { AgentBrowserCommand, AgentBrowserOutcome } from "@nexu/shared";
import { useEffect } from "react";
import { postApiV1BrowserAgentResult } from "../../../lib/api/sdk.gen";
import {
  getAgentBrowserExecutor,
  requestAgentBrowserOpen,
  waitForAgentBrowserPanel,
} from "./agent-browser-relay";
import { openBrowserPanel } from "./browser-panel-store";

/**
 * Subscribes the desktop window to the agent's browser command stream.
 *
 * Mounted at the workspace layout because it has to be listening before the
 * panel exists — the agent's first command is usually the one that opens it.
 */

type CommandEnvelope = {
  requestId: string;
  sessionKey: string;
  command: AgentBrowserCommand;
};

// A cold panel has to mount, create the view, and load a page. Anything past
// this and the controller's own 30s ceiling would fire first anyway.
const PANEL_WAIT_MS = 12_000;

const NOT_OPEN =
  "the browser panel is not open — call browser_open first so the user can see the page";

/**
 * The right-hand workbench belongs to the session conversation, and the layout
 * closes it anywhere else. Opening it from outside would put the panel on
 * screen for a single frame and then execute into a browser view the user
 * cannot see.
 */
const OFF_SESSION =
  "the user is not viewing a conversation right now, so there is nowhere to show the page — ask them to open the chat and try again";

function isSessionRoute(): boolean {
  return window.location.pathname.startsWith("/workspace/sessions");
}

function parseEnvelope(data: string): CommandEnvelope | null {
  try {
    const parsed: unknown = JSON.parse(data);
    if (!parsed || typeof parsed !== "object") return null;
    const { requestId, sessionKey, command } = parsed as CommandEnvelope;
    if (typeof requestId !== "string" || typeof sessionKey !== "string") {
      return null;
    }
    if (!command || typeof command !== "object") return null;
    return { requestId, sessionKey, command };
  } catch {
    return null;
  }
}

async function runCommand(
  envelope: CommandEnvelope,
): Promise<AgentBrowserOutcome> {
  // `open` is the one command allowed to bring the panel into existence; the
  // rest need a panel the user already has in front of them.
  if (envelope.command.action === "open") {
    if (!getAgentBrowserExecutor() && !isSessionRoute()) {
      return { ok: false, error: OFF_SESSION };
    }
    requestAgentBrowserOpen(envelope.command.url);
    openBrowserPanel(envelope.sessionKey);
  }

  if (!(await waitForAgentBrowserPanel(PANEL_WAIT_MS))) {
    return { ok: false, error: NOT_OPEN };
  }
  // Read the panel again here, not before the await: it may have opened and
  // closed again while we waited.
  const executor = getAgentBrowserExecutor();
  if (!executor) return { ok: false, error: NOT_OPEN };

  try {
    return await executor(envelope.command);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function useAgentBrowserRelay(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const source = new EventSource(
      `${window.location.origin}/api/v1/browser/agent/stream`,
    );
    let disposed = false;

    source.addEventListener("command", (event) => {
      const envelope = parseEnvelope((event as MessageEvent<string>).data);
      if (!envelope) return;
      void runCommand(envelope).then((outcome) => {
        if (disposed) return;
        void postApiV1BrowserAgentResult({
          body: { requestId: envelope.requestId, outcome },
        });
      });
    });

    return () => {
      disposed = true;
      source.close();
    };
  }, [enabled]);
}
