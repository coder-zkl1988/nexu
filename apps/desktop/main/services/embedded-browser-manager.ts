import { BrowserWindow, WebContentsView } from "electron";
import type {
  DesktopBrowserControl,
  DesktopBrowserControlResult,
} from "../../shared/host";

type ManagedTab = {
  owner: BrowserWindow;
  view: WebContentsView;
  navigationId: number;
  pendingUrl: string | null;
  pendingLoad: Promise<void> | null;
};

const TAB_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

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
    const tab: ManagedTab = {
      owner,
      view,
      navigationId: 0,
      pendingUrl: null,
      pendingLoad: null,
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
      owner.contentView.removeChildView(tab.view);
      if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
      this.tabs.delete(key);
    }
  }

  async control(
    sender: Electron.WebContents,
    input: DesktopBrowserControl,
  ): Promise<DesktopBrowserControlResult> {
    const owner = resolveOwnerWindow(sender);
    if (input.action === "hide" || input.action === "dispose") {
      for (const tab of this.tabs.values()) {
        if (tab.owner === owner) tab.view.setVisible(false);
      }
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

    const image = await tab.view.webContents.capturePage();
    return { kind: "capture", dataUrl: image.toDataURL() };
  }
}

export const embeddedBrowserManager = new EmbeddedBrowserManager();
