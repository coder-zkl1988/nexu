import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";

type FakeWebContents = {
  isDestroyed: () => boolean;
  executeJavaScript: ReturnType<typeof vi.fn>;
};

type FakeWindow = {
  isDestroyed: () => boolean;
  getTitle: () => string;
  webContents: FakeWebContents;
};

const electronState = vi.hoisted(() => ({
  windows: [] as unknown[],
  contentsById: new Map<number, unknown>(),
}));

vi.mock("electron", () => ({
  app: { isPackaged: false },
  BrowserWindow: {
    getAllWindows: () => electronState.windows,
    fromWebContents: (contents: unknown) =>
      (electronState.windows as FakeWindow[]).find(
        (window) => window.webContents === contents,
      ) ?? null,
  },
  webContents: {
    fromId: (id: number) => electronState.contentsById.get(id),
  },
}));

const ipcMocks = vi.hoisted(() => ({
  captureDesktopDevScreenshot: vi.fn(async () => ({
    mimeType: "image/png",
    base64: "",
    width: 1,
    height: 1,
    scaleFactor: 1,
  })),
  evaluateDesktopDevScript: vi.fn(async () => ({
    ok: true,
    valueType: "string",
    value: "",
  })),
  captureDesktopDevDomSnapshot: vi.fn(async () => ({
    title: "",
    url: "",
    readyState: "complete",
    htmlLength: 0,
    htmlSummary: "",
  })),
  getDesktopDevRendererLogSnapshot: vi.fn(() => ({
    entries: [],
    truncated: false,
  })),
}));

vi.mock("../../apps/desktop/main/ipc", () => ipcMocks);

import { handleDesktopDevInspectRequest } from "../../apps/desktop/main/services/dev-inspect-server";

function makeContents(options?: {
  probeResult?: unknown;
  probeRejects?: boolean;
  destroyed?: boolean;
}): FakeWebContents {
  return {
    isDestroyed: () => options?.destroyed ?? false,
    executeJavaScript: vi.fn(async () => {
      if (options?.probeRejects) {
        throw new Error("probe failed");
      }
      return options?.probeResult ?? null;
    }),
  };
}

function makeWindow(title: string, contents: FakeWebContents): FakeWindow {
  return {
    isDestroyed: () => false,
    getTitle: () => title,
    webContents: contents,
  };
}

function makeRequest(
  method: string,
  url: string,
  body?: string,
): IncomingMessage {
  const request = Object.assign(new EventEmitter(), { method, url });
  queueMicrotask(() => {
    if (body !== undefined) {
      request.emit("data", Buffer.from(body));
    }
    request.emit("end");
  });
  return request as unknown as IncomingMessage;
}

describe("desktop dev inspect target resolution", () => {
  beforeEach(() => {
    electronState.windows = [];
    electronState.contentsById = new Map();
    ipcMocks.captureDesktopDevScreenshot.mockClear();
    ipcMocks.evaluateDesktopDevScript.mockClear();
    ipcMocks.captureDesktopDevDomSnapshot.mockClear();
    ipcMocks.getDesktopDevRendererLogSnapshot.mockClear();
  });

  it("routes eval to the visible webview guest of the main window", async () => {
    const guestContents = makeContents();
    const shellContents = makeContents({ probeResult: 77 });
    electronState.windows = [makeWindow("tabby", shellContents)];
    electronState.contentsById.set(77, guestContents);

    await handleDesktopDevInspectRequest(
      makeRequest("POST", "/eval", JSON.stringify({ script: "1 + 1" })),
    );

    expect(ipcMocks.evaluateDesktopDevScript).toHaveBeenCalledWith(
      guestContents,
      "1 + 1",
    );
  });

  it("routes dom snapshots to the visible webview guest", async () => {
    const guestContents = makeContents();
    const shellContents = makeContents({ probeResult: 77 });
    electronState.windows = [makeWindow("tabby", shellContents)];
    electronState.contentsById.set(77, guestContents);

    await handleDesktopDevInspectRequest(
      makeRequest("POST", "/dom", JSON.stringify({ maxHtmlLength: 5000 })),
    );

    expect(ipcMocks.captureDesktopDevDomSnapshot).toHaveBeenCalledWith(
      guestContents,
      5000,
    );
  });

  it("falls back to the shell renderer when no webview is visible", async () => {
    const shellContents = makeContents({ probeResult: null });
    electronState.windows = [makeWindow("tabby", shellContents)];

    await handleDesktopDevInspectRequest(
      makeRequest("POST", "/eval", JSON.stringify({ script: "1 + 1" })),
    );

    expect(ipcMocks.evaluateDesktopDevScript).toHaveBeenCalledWith(
      shellContents,
      "1 + 1",
    );
  });

  it("falls back to the shell renderer when the visibility probe fails", async () => {
    const shellContents = makeContents({ probeRejects: true });
    electronState.windows = [makeWindow("tabby", shellContents)];

    await handleDesktopDevInspectRequest(
      makeRequest("POST", "/eval", JSON.stringify({ script: "1 + 1" })),
    );

    expect(ipcMocks.evaluateDesktopDevScript).toHaveBeenCalledWith(
      shellContents,
      "1 + 1",
    );
  });

  it("falls back to the shell renderer when the reported guest is destroyed", async () => {
    const guestContents = makeContents({ destroyed: true });
    const shellContents = makeContents({ probeResult: 77 });
    electronState.windows = [makeWindow("tabby", shellContents)];
    electronState.contentsById.set(77, guestContents);

    await handleDesktopDevInspectRequest(
      makeRequest("POST", "/eval", JSON.stringify({ script: "1 + 1" })),
    );

    expect(ipcMocks.evaluateDesktopDevScript).toHaveBeenCalledWith(
      shellContents,
      "1 + 1",
    );
  });

  it("keeps screenshots on the main window renderer, not the guest", async () => {
    const guestContents = makeContents();
    const shellContents = makeContents({ probeResult: 77 });
    electronState.windows = [makeWindow("tabby", shellContents)];
    electronState.contentsById.set(77, guestContents);

    await handleDesktopDevInspectRequest(makeRequest("POST", "/screenshot"));

    expect(ipcMocks.captureDesktopDevScreenshot).toHaveBeenCalledWith(
      shellContents,
    );
  });

  it("skips the deskpet window when picking the main window", async () => {
    const deskpetContents = makeContents();
    const shellContents = makeContents({ probeResult: null });
    electronState.windows = [
      makeWindow("Tabby Deskpet", deskpetContents),
      makeWindow("tabby", shellContents),
    ];

    await handleDesktopDevInspectRequest(
      makeRequest("POST", "/eval", JSON.stringify({ script: "1 + 1" })),
    );

    expect(ipcMocks.evaluateDesktopDevScript).toHaveBeenCalledWith(
      shellContents,
      "1 + 1",
    );
  });

  it("serves renderer logs without requiring a renderer window", async () => {
    electronState.windows = [];

    await handleDesktopDevInspectRequest(makeRequest("GET", "/logs?limit=5"));

    expect(ipcMocks.getDesktopDevRendererLogSnapshot).toHaveBeenCalledWith(5);
  });
});
