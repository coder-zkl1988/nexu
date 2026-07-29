import type {
  AgentBrowserCommand,
  AgentBrowserOutcome,
  AgentBrowserSnapshot,
} from "@nexu/shared";
import type { BrowserWindow } from "electron";
import {
  type CommandEnvelope,
  buildObservation,
  drainFrames,
  parseCommandFrame,
} from "./agent-browser-protocol";
import {
  AGENT_TAB_ID,
  embeddedBrowserManager,
} from "./embedded-browser-manager";

/**
 * Runs the agent's browser commands against the embedded browser.
 *
 *   nexu-browser plugin --POST /act--> controller --SSE--> here --> WebContentsView
 *                       <--------- POST /result <---------
 *
 * This lives in the main process, not the renderer, because the browser view
 * does. An earlier version made the panel component the executor so that a
 * closed panel could not act; in practice that meant collapsing the sidebar
 * destroyed the page mid-task, and a conversation held anywhere but the
 * workspace route — webchat, for one — had no executor at all. Visibility is
 * now carried by `open` raising the panel rather than by the executor's
 * lifetime.
 */

// Long enough for a click to start a navigation or a framework to re-render,
// short enough that a no-op click still answers quickly.
const SETTLE_MS = 700;
// A viewport resize has to reach the renderer and produce a new layout before
// element coordinates mean anything.
const RELAYOUT_MS = 250;
// Long enough for the panel to mount and place the view, short enough to fall
// back well inside the controller's own 30s ceiling.
const PANEL_WAIT_MS = 4_000;
const RECONNECT_DELAY_MS = 2_000;
/**
 * How long to wait for any frame before assuming the stream is dead.
 *
 * The controller pings every 15s. A restarted controller does not necessarily
 * break the socket — measured, the connection stayed open and silent while the
 * new instance had no subscriber registered, so the relay sat there reading
 * from a stream that would never produce anything and the agent's browser was
 * simply gone until the desktop was restarted. Silence, not socket errors, is
 * what has to trigger the reconnect.
 */
const STREAM_IDLE_TIMEOUT_MS = 45_000;
/** The controller answers immediately when healthy; anything slower is stuck. */
const CONNECT_TIMEOUT_MS = 8_000;

const NO_WINDOW =
  "the desktop window is not available right now — ask the user to bring Nexu to the front and try again";

function normalizeUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || /\s/u.test(trimmed)) return null;
  const hasScheme = /^https?:\/\//iu.test(trimmed);
  if (!hasScheme && /^[a-z][a-z\d+.-]*:/iu.test(trimmed)) return null;
  try {
    const url = new URL(hasScheme ? trimmed : `https://${trimmed}`);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export type AgentBrowserRelayOptions = {
  controllerBaseUrl: string;
  getWindow: () => BrowserWindow | null;
  /** Raises the browser panel so the user sees the page the agent opened. */
  onOpen: (url: string) => void;
  /**
   * Connection lifecycle, not just failures.
   *
   * A relay that has quietly stopped reconnecting is indistinguishable from
   * "the agent has no browser" from the transcript alone; the connect/end/fail
   * trail is what makes the difference readable.
   */
  onLog?: (message: string) => void;
};

export class AgentBrowserRelay {
  private abort: AbortController | null = null;
  private stopped = false;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(private readonly options: AgentBrowserRelayOptions) {}

  start(): void {
    this.stopped = false;
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.abort?.abort();
    this.abort = null;
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, RECONNECT_DELAY_MS);
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    const abort = new AbortController();
    this.abort = abort;
    // A connect that never answers has to time out too: the same replaced
    // controller can leave `fetch` itself hanging on a pooled connection.
    const connectTimer = setTimeout(() => abort.abort(), CONNECT_TIMEOUT_MS);
    try {
      const response = await fetch(
        `${this.options.controllerBaseUrl}/api/v1/browser/agent/stream`,
        { headers: { accept: "text/event-stream" }, signal: abort.signal },
      );
      clearTimeout(connectTimer);
      if (!response.ok || !response.body) {
        throw new Error(`stream responded ${response.status}`);
      }
      this.options.onLog?.(`connected to ${this.options.controllerBaseUrl}`);
      await this.readStream(response.body);
      this.options.onLog?.("stream ended");
    } catch (error: unknown) {
      this.options.onLog?.(
        `stream failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      clearTimeout(connectTimer);
      abort.abort();
    }
    this.scheduleReconnect();
  }

  private async readStream(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (!this.stopped) {
        // Race the read against the idle deadline rather than trusting the
        // abort signal to reach it. Measured: when the controller was replaced,
        // the body stream neither ended nor errored — `reader.read()` simply
        // never settled, so aborting the fetch changed nothing and the relay
        // sat on a dead stream until the desktop was restarted.
        const chunk = await Promise.race([reader.read(), this.idleDeadline()]);
        if (chunk.done) return;
        buffer += decoder.decode(chunk.value, { stream: true });
        const { frames, rest } = drainFrames(buffer);
        buffer = rest;
        for (const frame of frames) {
          const envelope = parseCommandFrame(frame);
          if (envelope) void this.runAndReport(envelope);
        }
      }
    } finally {
      // The read may still be pending; cancelling releases the socket so the
      // reconnect does not stack a second stream on top of it.
      void reader.cancel().catch(() => undefined);
    }
  }

  private idleDeadline(): Promise<never> {
    return new Promise((_resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("stream idle")),
        STREAM_IDLE_TIMEOUT_MS,
      );
      timer.unref?.();
    });
  }

  private async runAndReport(envelope: CommandEnvelope): Promise<void> {
    let outcome: AgentBrowserOutcome;
    try {
      outcome = await this.run(envelope.command);
    } catch (error: unknown) {
      outcome = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    try {
      await fetch(
        `${this.options.controllerBaseUrl}/api/v1/browser/agent/result`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ requestId: envelope.requestId, outcome }),
        },
      );
    } catch (error: unknown) {
      // The controller has its own timeout; a lost result surfaces there.
      this.options.onLog?.(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async run(
    command: AgentBrowserCommand,
  ): Promise<AgentBrowserOutcome> {
    const owner = this.options.getWindow();
    if (!owner || owner.isDestroyed()) return { ok: false, error: NO_WINDOW };

    /** Places the view well enough to read from. Reads need no hit-testing. */
    const reveal = async (): Promise<void> => {
      if (!embeddedBrowserManager.revealAgentTab(owner)) return;
      await new Promise((resolve) => setTimeout(resolve, RELAYOUT_MS));
    };

    /**
     * Gets the panel to host the view before acting on it.
     *
     * Clicks are only reliable in a panel-placed view: measured, a click into a
     * view the manager positioned itself is swallowed while the same click into
     * a panel-hosted view lands, and no amount of visibility, bounds, focus or
     * settling changed that. So an agent that wants to act raises the panel —
     * which is also the honest behaviour, since the user should see the click
     * that is about to happen.
     */
    const ensureHosted = async (url: string): Promise<void> => {
      if (embeddedBrowserManager.isAgentTabPanelHosted(owner)) return;
      this.options.onOpen(url);
      const hosted = await embeddedBrowserManager.waitForAgentTabPanel(
        owner,
        PANEL_WAIT_MS,
      );
      // No panel arrived — the window may be on a route that has none. Place
      // the view ourselves and try anyway rather than refuse outright.
      if (!hosted) await reveal();
    };

    const snapshot = async (): Promise<AgentBrowserSnapshot> => {
      const result = await embeddedBrowserManager.controlWindow(owner, {
        action: "snapshot",
        tabId: AGENT_TAB_ID,
      });
      if (result?.kind !== "snapshot")
        throw new Error("could not read the page");
      const { kind: _kind, ...rest } = result;
      return rest;
    };

    if (command.action === "open") {
      const url = normalizeUrl(command.url);
      if (!url) return { ok: false, error: "invalid web address" };
      // Reveal before navigating so the page lays out at the size it will be
      // measured and clicked at, rather than being resized underneath itself.
      await reveal();
      await embeddedBrowserManager.controlWindow(owner, {
        action: "navigate",
        tabId: AGENT_TAB_ID,
        url,
      });
      this.options.onOpen(url);
      return { ok: true, snapshot: await snapshot() };
    }
    if (command.action === "snapshot") {
      return { ok: true, snapshot: await snapshot() };
    }
    if (command.action === "scroll") {
      await ensureHosted((await snapshot()).url);
      await embeddedBrowserManager.controlWindow(owner, {
        action: "scroll",
        tabId: AGENT_TAB_ID,
        deltaY: command.deltaY,
      });
      const after = await snapshot();
      return {
        ok: true,
        observation: { url: after.url, title: after.title, navigated: false },
      };
    }

    const urlBefore = (await snapshot()).url;
    await ensureHosted(urlBefore);
    if (command.action === "click") {
      await embeddedBrowserManager.controlWindow(owner, {
        action: "click-ref",
        tabId: AGENT_TAB_ID,
        ref: command.ref,
      });
    } else {
      await embeddedBrowserManager.controlWindow(owner, {
        action: "type-ref",
        tabId: AGENT_TAB_ID,
        ref: command.ref,
        text: command.text,
        submit: command.submit,
      });
    }
    // Clicks and submits kick off navigation and re-render asynchronously;
    // snapshotting immediately would read the page as it was.
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

    // Read the page back and report the element that was acted on. This is the
    // completion evidence: a click that did nothing shows an unchanged element,
    // and a click that navigated shows a new URL.
    return {
      ok: true,
      observation: buildObservation(await snapshot(), command.ref, urlBefore),
    };
  }
}
