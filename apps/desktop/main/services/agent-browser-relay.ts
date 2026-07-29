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

export type AgentBrowserRelayTiming = {
  /** Post-action settle before the evidence snapshot: long enough for a click
   * to start a navigation or a framework to re-render, short enough that a
   * no-op click still answers quickly. */
  settleMs: number;
  /** Long enough for the panel to mount and place the view, short enough to
   * fail well inside the controller's own 30s ceiling. */
  panelWaitMs: number;
  reconnectDelayMs: number;
  /**
   * How long to wait for any frame before assuming the stream is dead.
   *
   * The controller pings every 15s. A restarted controller does not
   * necessarily break the socket — measured, the connection stayed open and
   * silent, so the relay sat reading from a stream that would never produce
   * anything and the agent's browser was simply gone until the desktop was
   * restarted. Silence, not socket errors, is what triggers the reconnect.
   */
  streamIdleTimeoutMs: number;
  /** The controller answers immediately when healthy; slower is stuck. */
  connectTimeoutMs: number;
};

const DEFAULT_TIMING: AgentBrowserRelayTiming = {
  settleMs: 700,
  panelWaitMs: 4_000,
  reconnectDelayMs: 2_000,
  streamIdleTimeoutMs: 45_000,
  connectTimeoutMs: 8_000,
};

const NO_WINDOW =
  "the desktop window is not available right now — ask the user to bring Nexu to the front and try again";

const NO_PANEL =
  "the browser panel did not open, so there is nowhere the user could watch this happen — ask them to open a conversation in Nexu and try again. Reading the page still works.";

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
  /** Test override; production uses the defaults. */
  timing?: Partial<AgentBrowserRelayTiming>;
};

export class AgentBrowserRelay {
  private abort: AbortController | null = null;
  private stopped = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private readonly timing: AgentBrowserRelayTiming;

  constructor(private readonly options: AgentBrowserRelayOptions) {
    this.timing = { ...DEFAULT_TIMING, ...options.timing };
  }

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
    }, this.timing.reconnectDelayMs);
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    const abort = new AbortController();
    this.abort = abort;
    // A connect that never answers has to time out too: the same replaced
    // controller can leave `fetch` itself hanging on a pooled connection.
    const connectTimer = setTimeout(
      () => abort.abort(),
      this.timing.connectTimeoutMs,
    );
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
    // The watchdog cancels the reader after silence. Cancelling closes the
    // stream, which resolves a pending `read()` as done even when the
    // underlying socket is wedged — measured: a replaced controller left the
    // socket open and silent, `reader.read()` never settled, and aborting the
    // fetch did not reach it. One resettable timer, not a `Promise.race`
    // against a deadline: the losing deadline promise of a race still rejects
    // later, and every such rejection is an unhandled one.
    let idleTimer: NodeJS.Timeout | null = null;
    const armWatchdog = (): void => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        this.options.onLog?.("stream idle, cancelling");
        void reader.cancel().catch(() => undefined);
      }, this.timing.streamIdleTimeoutMs);
    };
    try {
      armWatchdog();
      while (!this.stopped) {
        const chunk = await reader.read();
        if (chunk.done) return;
        armWatchdog();
        buffer += decoder.decode(chunk.value, { stream: true });
        const { frames, rest } = drainFrames(buffer);
        buffer = rest;
        for (const frame of frames) {
          const envelope = parseCommandFrame(frame);
          if (envelope) void this.runAndReport(envelope);
        }
      }
    } finally {
      if (idleTimer) clearTimeout(idleTimer);
      // The read may still be pending; cancelling releases the socket so the
      // reconnect does not stack a second stream on top of it.
      void reader.cancel().catch(() => undefined);
    }
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

    /**
     * Gets the panel to host the view before acting on it.
     *
     * Clicks are only reliable in a panel-placed view: measured, a click into a
     * view the main process positioned itself is swallowed while the same click
     * into a panel-hosted view lands, and no amount of visibility, bounds,
     * focus or settling changed that.
     *
     * Failing here rather than placing the view as a fallback is deliberate.
     * The main process can only show a bare `WebContentsView` — no address bar,
     * no tabs, no header — which lands as a raw page pasted over the app that
     * the user can neither navigate nor dismiss, all to perform a click that
     * would have been swallowed anyway.
     */
    const ensureHosted = async (url: string): Promise<boolean> => {
      if (embeddedBrowserManager.isAgentTabPanelHosted(owner)) return true;
      this.options.onOpen(url);
      return embeddedBrowserManager.waitForAgentTabPanel(
        owner,
        this.timing.panelWaitMs,
      );
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
      // Reading a page needs no hit-testing, so `open` works whether or not the
      // panel ever shows up. Ask for it anyway — the point of this browser is
      // that the user can watch it.
      embeddedBrowserManager.ensureAgentTab(owner);
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
      if (!(await ensureHosted((await snapshot()).url))) {
        return { ok: false, error: NO_PANEL };
      }
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
    if (!(await ensureHosted(urlBefore))) {
      return { ok: false, error: NO_PANEL };
    }
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
    await new Promise((resolve) => setTimeout(resolve, this.timing.settleMs));

    // Read the page back and report the element that was acted on. This is the
    // completion evidence: a click that did nothing shows an unchanged element,
    // and a click that navigated shows a new URL.
    return {
      ok: true,
      observation: buildObservation(await snapshot(), command.ref, urlBefore),
    };
  }
}
