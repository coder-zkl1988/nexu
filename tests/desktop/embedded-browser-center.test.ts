import { EventEmitter as NodeEventEmitter } from "node:events";
import type { BrowserWindow } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";

const electronMocks = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void;
  const createEmitter = () => {
    const listeners = new Map<string, Set<Listener>>();
    return {
      on(event: string, listener: Listener): void {
        const eventListeners = listeners.get(event) ?? new Set();
        eventListeners.add(listener);
        listeners.set(event, eventListeners);
      },
      emit(event: string, ...args: unknown[]): void {
        for (const listener of [...(listeners.get(event) ?? [])]) {
          listener(...args);
        }
      },
      removeAllListeners(): void {
        listeners.clear();
      },
    };
  };
  return {
    browserSession: createEmitter(),
    createEmitter,
    showItemInFolder: vi.fn(),
  };
});

vi.mock("electron", () => {
  class MockWebContents {
    private readonly events = electronMocks.createEmitter();
    readonly session = electronMocks.browserSession;
    readonly navigationHistory = {
      canGoBack: () => false,
      canGoForward: () => false,
      goBack: vi.fn(),
      goForward: vi.fn(),
    };
    private url = "";
    private title = "";

    on(event: string, listener: (...args: unknown[]) => void): this {
      this.events.on(event, listener);
      return this;
    }
    setWindowOpenHandler(): void {}
    getURL(): string {
      return this.url;
    }
    getTitle(): string {
      return this.title;
    }
    isLoading(): boolean {
      return false;
    }
    async loadURL(url: string): Promise<void> {
      this.url = url;
      this.title = new URL(url).hostname;
    }
    isDestroyed(): boolean {
      return false;
    }
    close(): void {}
    reload(): void {}
    stop(): void {}
  }

  class MockWebContentsView {
    readonly webContents = new MockWebContents();
    setBackgroundColor(): void {}
    setVisible(): void {}
    setBounds(): void {}
  }

  return {
    BrowserWindow: {
      fromWebContents: vi.fn(),
    },
    WebContentsView: MockWebContentsView,
    shell: { showItemInFolder: electronMocks.showItemInFolder },
  };
});

vi.mock("../../apps/desktop/main/services/embedded-browser-cdp", () => ({
  BrowserRefTable: class {
    reset(): void {}
  },
  captureSnapshot: vi.fn(),
  clickRef: vi.fn(),
  detachDebugger: vi.fn(),
  scrollBy: vi.fn(),
  typeIntoRef: vi.fn(),
}));

import {
  EmbeddedBrowserManager,
  agentTabId,
} from "../../apps/desktop/main/services/embedded-browser-manager";

type DownloadState = "progressing" | "completed" | "cancelled" | "interrupted";

class MockDownloadItem extends NodeEventEmitter {
  state: DownloadState = "progressing";
  receivedBytes = 0;

  getFilename(): string {
    return "report.pdf";
  }
  getSavePath(): string {
    return "/tmp/report.pdf";
  }
  getURL(): string {
    return "https://example.test/report.pdf";
  }
  getReceivedBytes(): number {
    return this.receivedBytes;
  }
  getTotalBytes(): number {
    return 100;
  }
}

function createOwner(id: number): BrowserWindow {
  const events = new NodeEventEmitter();
  return {
    id,
    contentView: {
      addChildView: vi.fn(),
      removeChildView: vi.fn(),
    },
    getContentBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }),
    once: events.once.bind(events),
  } as unknown as BrowserWindow;
}

describe("embedded browser control center", () => {
  beforeEach(() => {
    electronMocks.browserSession.removeAllListeners();
    electronMocks.showItemInFolder.mockReset();
  });

  it("reports the agent tab and blocks recreating it after sharing is revoked", async () => {
    const manager = new EmbeddedBrowserManager();
    const owner = createOwner(7);
    const AGENT_TAB_ID = agentTabId("agent:bot:main");
    manager.ensureAgentTab(owner, AGENT_TAB_ID);

    await expect(
      manager.controlWindow(owner, {
        action: "navigate",
        tabId: AGENT_TAB_ID,
        url: "https://example.test/",
      }),
    ).resolves.toEqual({ kind: "ok" });
    await expect(
      manager.controlWindow(owner, { action: "center-state" }),
    ).resolves.toMatchObject({
      kind: "center-state",
      agentSharingEnabled: true,
      tabs: [
        {
          id: AGENT_TAB_ID,
          url: "https://example.test/",
          agentControlled: true,
        },
      ],
    });

    await manager.controlWindow(owner, { action: "revoke-agent" });

    await expect(
      manager.controlWindow(owner, {
        action: "navigate",
        tabId: AGENT_TAB_ID,
        url: "https://example.test/recreated",
      }),
    ).rejects.toThrow("revoked by the user");
    await expect(
      manager.controlWindow(owner, { action: "center-state" }),
    ).resolves.toMatchObject({
      agentSharingEnabled: false,
      tabs: [],
    });
  });

  it("tracks download progress, reveals completed files, and clears history", async () => {
    const manager = new EmbeddedBrowserManager();
    const owner = createOwner(11);
    manager.ensureAgentTab(owner, agentTabId("agent:bot:main"));
    const item = new MockDownloadItem();
    electronMocks.browserSession.emit("will-download", {}, item, undefined);
    item.receivedBytes = 40;
    item.emit("updated", {}, "progressing");

    const progressing = await manager.controlWindow(owner, {
      action: "center-state",
    });
    expect(progressing).toMatchObject({
      kind: "center-state",
      downloads: [
        {
          filename: "report.pdf",
          state: "progressing",
          receivedBytes: 40,
          totalBytes: 100,
        },
      ],
    });
    if (progressing.kind !== "center-state") {
      throw new Error("Expected browser center state");
    }
    const downloadId = progressing.downloads[0]?.id;
    if (!downloadId) throw new Error("Expected tracked download");

    item.receivedBytes = 100;
    item.state = "completed";
    item.emit("done", {}, "completed");
    await manager.controlWindow(owner, {
      action: "show-download",
      downloadId,
    });
    expect(electronMocks.showItemInFolder).toHaveBeenCalledWith(
      "/tmp/report.pdf",
    );

    await manager.controlWindow(owner, { action: "clear-downloads" });
    await expect(
      manager.controlWindow(owner, { action: "center-state" }),
    ).resolves.toMatchObject({ downloads: [] });
  });
});
