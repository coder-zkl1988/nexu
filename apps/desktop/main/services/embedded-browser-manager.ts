import { BrowserWindow, WebContentsView, shell } from "electron";
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

type ManagedDownload = {
  id: string;
  ownerId: number;
  filename: string;
  path: string;
  url: string;
  state: "progressing" | "completed" | "cancelled" | "interrupted";
  receivedBytes: number;
  totalBytes: number;
  startedAt: number;
  completedAt?: number;
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
 * A layout viewport for a tab the panel has not placed yet.
 *
 * Only ever applied while the view is hidden: a page still has to lay out at a
 * plausible size for a snapshot to describe what the user will eventually see.
 * The main process must not put the view *on screen* itself — with no address
 * bar, tabs or header it reads as a raw page pasted over the app, with no way
 * to navigate or dismiss it. Showing the view is the panel's job.
 */
function offscreenLayoutBounds(owner: BrowserWindow): Electron.Rectangle {
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
  private readonly downloads = new Map<string, ManagedDownload>();
  private readonly trackedSessions = new WeakSet<Electron.Session>();
  private readonly revokedAgentSharing = new Set<number>();
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

  isAgentSharingAllowed(owner: BrowserWindow): boolean {
    return !this.revokedAgentSharing.has(owner.id);
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
    view.setBounds(offscreenLayoutBounds(owner));
    const tab: ManagedTab = {
      owner,
      view,
      navigationId: 0,
      pendingUrl: null,
      pendingLoad: null,
      refs: new BrowserRefTable(),
    };
    this.tabs.set(key, tab);
    this.ensureDownloadTracking(owner, view.webContents.session);

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

  private ensureDownloadTracking(
    owner: BrowserWindow,
    browserSession: Electron.Session,
  ): void {
    if (this.trackedSessions.has(browserSession)) return;
    this.trackedSessions.add(browserSession);
    browserSession.on("will-download", (_event, item, webContents) => {
      const downloadOwner = [...this.tabs.values()].find(
        (tab) => tab.view.webContents === webContents,
      )?.owner;
      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const download: ManagedDownload = {
        id,
        ownerId: downloadOwner?.id ?? owner.id,
        filename: item.getFilename(),
        path: item.getSavePath(),
        url: item.getURL(),
        state: "progressing",
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
        startedAt: Date.now(),
      };
      this.downloads.set(id, download);
      item.on("updated", (_updatedEvent, state) => {
        download.filename = item.getFilename();
        download.path = item.getSavePath();
        download.receivedBytes = item.getReceivedBytes();
        download.totalBytes = item.getTotalBytes();
        download.state = state;
      });
      item.once("done", (_doneEvent, state) => {
        download.filename = item.getFilename();
        download.path = item.getSavePath();
        download.receivedBytes = item.getReceivedBytes();
        download.totalBytes = item.getTotalBytes();
        download.state = state;
        download.completedAt = Date.now();
        const retained = [...this.downloads.values()]
          .sort((left, right) => right.startedAt - left.startedAt)
          .slice(50);
        for (const stale of retained) this.downloads.delete(stale.id);
      });
    });
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
    this.revokedAgentSharing.delete(owner.id);
  }

  control(
    sender: Electron.WebContents,
    input: DesktopBrowserControl,
  ): Promise<DesktopBrowserControlResult> {
    return this.controlWindow(resolveOwnerWindow(sender), input);
  }

  /** Creates the agent's tab if needed, without putting it on screen. */
  ensureAgentTab(owner: BrowserWindow): void {
    this.ensureTab(owner, AGENT_TAB_ID);
  }

  async controlWindow(
    owner: BrowserWindow,
    input: DesktopBrowserControl,
  ): Promise<DesktopBrowserControlResult> {
    if (input.action === "center-state") {
      return {
        kind: "center-state",
        agentSharingEnabled: this.isAgentSharingAllowed(owner),
        tabs: [...this.tabs.entries()]
          .filter(([, tab]) => tab.owner === owner)
          .map(([key, tab]) => ({
            id: key.slice(key.indexOf(":") + 1),
            title: tab.view.webContents.getTitle() || "New tab",
            url: tab.view.webContents.getURL(),
            loading: tab.view.webContents.isLoading(),
            agentControlled: key.endsWith(`:${AGENT_TAB_ID}`),
          })),
        downloads: [...this.downloads.values()]
          .filter((download) => download.ownerId === owner.id)
          .sort((left, right) => right.startedAt - left.startedAt)
          .map(({ ownerId: _ownerId, path: _path, ...download }) => download),
      };
    }
    if (input.action === "clear-downloads") {
      for (const [id, download] of this.downloads) {
        if (download.ownerId === owner.id && download.state !== "progressing") {
          this.downloads.delete(id);
        }
      }
      return { kind: "ok" };
    }
    if (input.action === "show-download") {
      const download = this.downloads.get(input.downloadId);
      if (
        download?.ownerId === owner.id &&
        download.state === "completed" &&
        download.path
      ) {
        shell.showItemInFolder(download.path);
      }
      return { kind: "ok" };
    }
    if (input.action === "revoke-agent") {
      this.revokedAgentSharing.add(owner.id);
      const key = this.key(owner, AGENT_TAB_ID);
      const tab = this.tabs.get(key);
      if (tab) {
        owner.contentView.removeChildView(tab.view);
        if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
        this.tabs.delete(key);
      }
      this.markPanelHosted(owner, false);
      return { kind: "ok" };
    }
    if (input.action === "resume-agent") {
      this.revokedAgentSharing.delete(owner.id);
      return { kind: "ok" };
    }
    if (input.action === "hide" || input.action === "dispose") {
      for (const tab of this.tabs.values()) {
        if (tab.owner === owner) tab.view.setVisible(false);
      }
      this.markPanelHosted(owner, false);
      if (input.action === "dispose") this.disposeOwner(owner);
      return { kind: "ok" };
    }
    if (!("tabId" in input)) throw new Error("Browser tab id is required.");
    if (input.tabId === AGENT_TAB_ID && !this.isAgentSharingAllowed(owner)) {
      throw new Error(
        "Browser sharing was revoked by the user. Resume agent control before using this tab.",
      );
    }

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
