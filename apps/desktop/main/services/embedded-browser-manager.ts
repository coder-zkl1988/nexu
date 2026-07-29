import { BrowserWindow, WebContentsView } from "electron";
import type {
  DesktopBrowserControl,
  DesktopBrowserControlResult,
} from "../../shared/host";
import {
  BrowserRefTable,
  captureSnapshot,
  clickRef,
  detachDebugger,
  scrollBy,
  typeIntoRef,
} from "./embedded-browser-cdp";

type ManagedTab = {
  owner: BrowserWindow;
  view: WebContentsView;
  navigationId: number;
  pendingUrl: string | null;
  pendingLoad: Promise<void> | null;
  refs: BrowserRefTable;
};

const DEFAULT_SNAPSHOT_NODES = 400;

const TAB_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * The tab the agent drives. Fixed rather than generated so the panel can adopt
 * it by id after a remount: the renderer's tab ids live in React state, which
 * a collapsed panel throws away, while this tab outlives it in the main
 * process.
 */
export const AGENT_TAB_ID = "agent";

function isSafeBrowserUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isAbortedNavigation(error: unknown): boolean {
  return error instanceof Error && error.message.includes("ERR_ABORTED");
}

function resolveOwnerWindow(sender: Electron.WebContents): BrowserWindow {
  let ownerContents = sender;
  while (ownerContents.hostWebContents) {
    ownerContents = ownerContents.hostWebContents;
  }
  const owner = BrowserWindow.fromWebContents(ownerContents);
  if (!owner || owner.isDestroyed()) {
    throw new Error("Could not resolve the browser host window.");
  }
  return owner;
}

function clampBounds(
  owner: BrowserWindow,
  bounds: { x: number; y: number; width: number; height: number },
): Electron.Rectangle {
  const content = owner.getContentBounds();
  const x = Math.max(0, Math.round(bounds.x));
  const y = Math.max(0, Math.round(bounds.y));
  return {
    x,
    y,
    width: Math.max(1, Math.min(Math.round(bounds.width), content.width - x)),
    height: Math.max(
      1,
      Math.min(Math.round(bounds.height), content.height - y),
    ),
  };
}

/**
 * Where the agent's tab goes when the panel is not placing it.
 *
 * Synthesized clicks need the view on screen: measured, the same click that
 * navigates a shown view does nothing at all when the view is hidden with
 * `setVisible(false)` *or* parked outside the window bounds — both take it out
 * of hit-testing, and the action fails silently. So an agent acting without a
 * panel to host it gets this fallback placement rather than a dead view. The
 * panel overrides it with real bounds as soon as it opens.
 */
function agentFallbackBounds(owner: BrowserWindow): Electron.Rectangle {
  const content = owner.getContentBounds();
  const width = Math.max(1, Math.round(content.width * 0.45));
  return {
    x: Math.max(0, content.width - width),
    y: 0,
    width,
    height: Math.max(1, content.height),
  };
}

const elementPickerScript = `new Promise((resolve) => {
  const marker = "data-nexu-element-picker";
  document.querySelector("[" + marker + "]")?.remove();
  const overlay = document.createElement("div");
  overlay.setAttribute(marker, "");
  Object.assign(overlay.style, {
    position: "fixed", pointerEvents: "none", zIndex: "2147483647",
    border: "2px solid #2563eb", background: "rgba(37,99,235,.12)", display: "none"
  });
  document.documentElement.append(overlay);
  const previousCursor = document.documentElement.style.cursor;
  document.documentElement.style.cursor = "crosshair";
  const selectorFor = (element) => {
    if (element.id) return "#" + CSS.escape(element.id);
    const parts = [];
    let current = element;
    while (current && parts.length < 5) {
      let part = current.tagName.toLowerCase();
      const classes = Array.from(current.classList).slice(0, 2);
      if (classes.length) part += classes.map((name) => "." + CSS.escape(name)).join("");
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
        if (siblings.length > 1) part += ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")";
      }
      parts.unshift(part);
      current = parent;
    }
    return parts.join(" > ");
  };
  const cleanup = () => {
    overlay.remove();
    document.documentElement.style.cursor = previousCursor;
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKeyDown, true);
  };
  const onMove = (event) => {
    const element = event.target;
    if (!(element instanceof Element) || element === overlay) return;
    const rect = element.getBoundingClientRect();
    Object.assign(overlay.style, { display: "block", left: rect.left + "px", top: rect.top + "px", width: rect.width + "px", height: rect.height + "px" });
  };
  const onClick = (event) => {
    const element = event.target;
    if (!(element instanceof Element)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const result = {
      url: location.href,
      selector: selectorFor(element),
      tagName: element.tagName.toLowerCase(),
      text: (element.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 1200),
      ariaLabel: (element.getAttribute("aria-label") || "").slice(0, 300)
    };
    cleanup();
    resolve(result);
  };
  const onKeyDown = (event) => {
    if (event.key !== "Escape") return;
    cleanup();
    resolve(null);
  };
  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKeyDown, true);
})`;

export class EmbeddedBrowserManager {
  private readonly tabs = new Map<string, ManagedTab>();
  /**
   * Windows whose panel is currently hosting the agent tab.
   *
   * Synthesized clicks are only reliable in a view the panel has placed:
   * measured, the first click into a view the manager positioned itself is
   * swallowed, while every click into a panel-hosted view lands. So mutating
   * commands wait for this rather than acting into a view that will silently
   * ignore them.
   */
  private readonly panelHosted = new Set<number>();
  private readonly panelWaiters = new Map<number, Set<() => void>>();

  isAgentTabPanelHosted(owner: BrowserWindow): boolean {
    return this.panelHosted.has(owner.id);
  }

  /** Resolves true once the panel places the agent tab, false on timeout. */
  waitForAgentTabPanel(
    owner: BrowserWindow,
    timeoutMs: number,
  ): Promise<boolean> {
    if (this.isAgentTabPanelHosted(owner)) return Promise.resolve(true);
    return new Promise((resolve) => {
      const waiters = this.panelWaiters.get(owner.id) ?? new Set();
      const settle = (): void => {
        clearTimeout(timer);
        waiters.delete(settle);
        resolve(true);
      };
      const timer = setTimeout(() => {
        waiters.delete(settle);
        resolve(false);
      }, timeoutMs);
      waiters.add(settle);
      this.panelWaiters.set(owner.id, waiters);
    });
  }

  private markPanelHosted(owner: BrowserWindow, hosted: boolean): void {
    if (!hosted) {
      this.panelHosted.delete(owner.id);
      return;
    }
    this.panelHosted.add(owner.id);
    const waiters = this.panelWaiters.get(owner.id);
    if (!waiters) return;
    for (const waiter of [...waiters]) waiter();
  }

  private key(owner: BrowserWindow, tabId: string): string {
    if (!TAB_ID_PATTERN.test(tabId)) throw new Error("Invalid browser tab id.");
    return `${owner.id}:${tabId}`;
  }

  private ensureTab(owner: BrowserWindow, tabId: string): ManagedTab {
    const key = this.key(owner, tabId);
    const existing = this.tabs.get(key);
    if (existing) return existing;

    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: "persist:nexu-browser",
      },
    });
    view.setBackgroundColor("#ffffff");
    view.setVisible(false);
    owner.contentView.addChildView(view);
    // Give the tab a real layout viewport before anything shows it, so a
    // snapshot taken straight after `navigate` measures the page at the size
    // it will actually be seen at.
    view.setBounds(agentFallbackBounds(owner));
    const tab: ManagedTab = {
      owner,
      view,
      navigationId: 0,
      pendingUrl: null,
      pendingLoad: null,
      refs: new BrowserRefTable(),
    };
    this.tabs.set(key, tab);

    view.webContents.setWindowOpenHandler(({ url }) => {
      if (isSafeBrowserUrl(url))
        setImmediate(() => void this.loadTab(tab, url));
      return { action: "deny" };
    });
    view.webContents.on("will-navigate", (event, url) => {
      if (!isSafeBrowserUrl(url)) event.preventDefault();
    });
    // Refs point at DOM nodes of the page that produced them. Surviving a
    // navigation would let a click land on whatever now occupies that id.
    view.webContents.on("did-start-navigation", (_event, _url, isInPlace) => {
      if (!isInPlace) tab.refs.reset();
    });
    owner.once("closed", () => this.disposeOwner(owner));
    return tab;
  }

  private loadTab(tab: ManagedTab, url: string): Promise<void> {
    if (tab.pendingUrl === url && tab.pendingLoad) return tab.pendingLoad;
    if (tab.view.webContents.getURL() === url) return Promise.resolve();

    const navigationId = ++tab.navigationId;
    tab.pendingUrl = url;
    const pendingLoad = tab.view.webContents
      .loadURL(url)
      .catch((error: unknown) => {
        const superseded = navigationId !== tab.navigationId;
        if (superseded && isAbortedNavigation(error)) return;
        throw error;
      })
      .finally(() => {
        if (navigationId !== tab.navigationId) return;
        tab.pendingUrl = null;
        tab.pendingLoad = null;
      });
    tab.pendingLoad = pendingLoad;
    return pendingLoad;
  }

  private disposeOwner(owner: BrowserWindow): void {
    for (const [key, tab] of this.tabs) {
      if (tab.owner !== owner) continue;
      detachDebugger(tab.view.webContents);
      owner.contentView.removeChildView(tab.view);
      if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
      this.tabs.delete(key);
    }
  }

  control(
    sender: Electron.WebContents,
    input: DesktopBrowserControl,
  ): Promise<DesktopBrowserControlResult> {
    return this.controlWindow(resolveOwnerWindow(sender), input);
  }

  /**
   * Puts the agent's tab on screen so its clicks can land.
   *
   * Called before every mutating agent command. If the panel is already
   * showing this tab it keeps the panel's bounds; otherwise it falls back to a
   * placement of its own, because a click into an off-screen view is a silent
   * no-op rather than an error.
   */
  revealAgentTab(owner: BrowserWindow): boolean {
    const tab = this.ensureTab(owner, AGENT_TAB_ID);
    if (tab.view.getVisible()) return false;
    tab.view.setBounds(agentFallbackBounds(owner));
    tab.view.setVisible(true);
    return true;
  }

  async controlWindow(
    owner: BrowserWindow,
    input: DesktopBrowserControl,
  ): Promise<DesktopBrowserControlResult> {
    if (input.action === "hide" || input.action === "dispose") {
      for (const tab of this.tabs.values()) {
        if (tab.owner === owner) tab.view.setVisible(false);
      }
      this.markPanelHosted(owner, false);
      if (input.action === "dispose") this.disposeOwner(owner);
      return { kind: "ok" };
    }
    if (!("tabId" in input)) throw new Error("Browser tab id is required.");

    const key = this.key(owner, input.tabId);
    if (input.action === "close-tab") {
      const tab = this.tabs.get(key);
      if (tab) {
        owner.contentView.removeChildView(tab.view);
        if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
        this.tabs.delete(key);
      }
      return { kind: "ok" };
    }

    const tab = this.ensureTab(owner, input.tabId);
    if (input.action === "show") {
      if (!isSafeBrowserUrl(input.url)) throw new Error("Invalid browser URL.");
      for (const candidate of this.tabs.values()) {
        if (candidate.owner === owner)
          candidate.view.setVisible(candidate === tab);
      }
      tab.view.setBounds(clampBounds(owner, input.bounds));
      this.markPanelHosted(owner, input.tabId === AGENT_TAB_ID);
      await this.loadTab(tab, input.url);
      return { kind: "ok" };
    }
    if (input.action === "navigate") {
      if (!isSafeBrowserUrl(input.url)) throw new Error("Invalid browser URL.");
      await this.loadTab(tab, input.url);
      return { kind: "ok" };
    }
    if (input.action === "command") {
      const history = tab.view.webContents.navigationHistory;
      if (input.command === "back" && history.canGoBack()) history.goBack();
      if (input.command === "forward" && history.canGoForward())
        history.goForward();
      if (input.command === "reload") tab.view.webContents.reload();
      if (input.command === "stop") tab.view.webContents.stop();
      return { kind: "ok" };
    }
    if (input.action === "state") {
      const history = tab.view.webContents.navigationHistory;
      return {
        kind: "state",
        url: tab.view.webContents.getURL(),
        title: tab.view.webContents.getTitle() || "New tab",
        loading: tab.view.webContents.isLoading(),
        canGoBack: history.canGoBack(),
        canGoForward: history.canGoForward(),
      };
    }
    if (input.action === "select-element") {
      const selection = (await tab.view.webContents.executeJavaScript(
        elementPickerScript,
        true,
      )) as Extract<
        DesktopBrowserControlResult,
        { kind: "selection" }
      >["selection"];
      return { kind: "selection", selection };
    }

    if (input.action === "snapshot") {
      const snapshot = await captureSnapshot(
        tab.view.webContents,
        tab.refs,
        Math.min(Math.max(input.maxNodes ?? DEFAULT_SNAPSHOT_NODES, 1), 1000),
      );
      return { kind: "snapshot", ...snapshot };
    }
    if (input.action === "click-ref") {
      await clickRef(tab.view.webContents, tab.refs, input.ref);
      return { kind: "ok" };
    }
    if (input.action === "type-ref") {
      await typeIntoRef(
        tab.view.webContents,
        tab.refs,
        input.ref,
        input.text,
        input.submit ?? false,
      );
      return { kind: "ok" };
    }
    if (input.action === "scroll") {
      await scrollBy(tab.view.webContents, input.deltaY);
      return { kind: "ok" };
    }

    const image = await tab.view.webContents.capturePage();
    return { kind: "capture", dataUrl: image.toDataURL() };
  }
}

export const embeddedBrowserManager = new EmbeddedBrowserManager();
