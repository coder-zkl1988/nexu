import {
  type IncomingMessage,
  type ServerResponse,
  createServer,
} from "node:http";
import { BrowserWindow, app, webContents } from "electron";
import type {
  DesktopDevDomSnapshotResult,
  DesktopDevEvalResult,
  DesktopDevRendererLogSnapshot,
  DesktopDevScreenshotResult,
} from "../../shared/host";
import {
  captureDesktopDevDomSnapshot,
  captureDesktopDevScreenshot,
  evaluateDesktopDevScript,
  getDesktopDevRendererLogSnapshot,
} from "../ipc";

type DesktopDevInspectServerOptions = {
  host: string;
  port: number;
  token: string;
};

type DesktopDevInspectResponse =
  | DesktopDevScreenshotResult
  | DesktopDevEvalResult
  | DesktopDevDomSnapshotResult
  | DesktopDevRendererLogSnapshot;

let desktopDevInspectServer: ReturnType<typeof createServer> | null = null;

function getDesktopDevTargetWindow(): Electron.BrowserWindow {
  const windows = BrowserWindow.getAllWindows().filter(
    (window) => !window.isDestroyed(),
  );
  const targetWindow =
    windows.find((window) => window.getTitle() !== "Tabby Deskpet") ??
    windows[0];

  if (!targetWindow) {
    throw new Error("No desktop renderer window is available.");
  }

  return targetWindow;
}

// The main window renderer is a thin shell that hosts the app surfaces in
// <webview> guests, so its own DOM is nearly empty. Runs in the shell and
// returns the webContents id of the currently visible, attached webview
// (hidden surfaces sit in display:none wrappers and measure 0x0), or null.
const visibleWebviewProbeScript = `(() => {
  for (const view of document.querySelectorAll("webview")) {
    const rect = view.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (typeof view.getWebContentsId !== "function") continue;
    try {
      return view.getWebContentsId();
    } catch {
      // Not attached yet - keep looking.
    }
  }
  return null;
})()`;

async function getDesktopDevScriptTargetContents(): Promise<Electron.WebContents> {
  const shellContents = getDesktopDevTargetWindow().webContents;
  const guestId: unknown = await shellContents
    .executeJavaScript(visibleWebviewProbeScript)
    .catch(() => null);

  if (typeof guestId === "number") {
    const guestContents = webContents.fromId(guestId);
    if (guestContents && !guestContents.isDestroyed()) {
      return guestContents;
    }
  }

  return shellContents;
}

function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    request.on("data", (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    request.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    request.on("error", reject);
  });
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  body: DesktopDevInspectResponse | { error: string },
): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(`${JSON.stringify(body)}\n`);
}

function readLimitFromUrl(request: IncomingMessage): number | undefined {
  const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
  const rawLimit = requestUrl.searchParams.get("limit");

  if (!rawLimit) {
    return undefined;
  }

  const limit = Number.parseInt(rawLimit, 10);
  return Number.isInteger(limit) && limit > 0 ? limit : undefined;
}

export async function handleDesktopDevInspectRequest(
  request: IncomingMessage,
): Promise<DesktopDevInspectResponse> {
  const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

  if (request.method === "POST" && requestUrl.pathname === "/screenshot") {
    return captureDesktopDevScreenshot(getDesktopDevTargetWindow().webContents);
  }

  if (request.method === "POST" && requestUrl.pathname === "/eval") {
    const body = JSON.parse(await readRequestBody(request)) as {
      script?: string;
    };

    if (!body.script) {
      throw new Error("Missing eval script.");
    }

    return evaluateDesktopDevScript(
      await getDesktopDevScriptTargetContents(),
      body.script,
    );
  }

  if (request.method === "POST" && requestUrl.pathname === "/dom") {
    const rawBody = await readRequestBody(request);
    const body =
      rawBody.length > 0
        ? (JSON.parse(rawBody) as { maxHtmlLength?: number })
        : {};

    return captureDesktopDevDomSnapshot(
      await getDesktopDevScriptTargetContents(),
      body.maxHtmlLength,
    );
  }

  if (request.method === "GET" && requestUrl.pathname === "/logs") {
    return getDesktopDevRendererLogSnapshot(readLimitFromUrl(request));
  }

  throw new Error(
    `Unsupported desktop dev inspect route: ${request.method ?? "GET"} ${requestUrl.pathname}`,
  );
}

export async function startDesktopDevInspectServer(
  options: DesktopDevInspectServerOptions,
): Promise<void> {
  if (app.isPackaged || desktopDevInspectServer) {
    return;
  }

  const server = createServer(async (request, response) => {
    if (request.headers["x-nexu-dev-inspect-token"] !== options.token) {
      writeJson(response, 401, {
        error: "Unauthorized desktop dev inspect request.",
      });
      return;
    }

    try {
      const result = await handleDesktopDevInspectRequest(request);
      writeJson(response, 200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeJson(response, 400, { error: message });
    }
  });
  desktopDevInspectServer = server;

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port, options.host, () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    // listen() failed (e.g. EADDRINUSE) - the server never actually bound,
    // so clear the module state or stopDesktopDevInspectServer() would later
    // call close() on a non-listening server and reject with ERR_SERVER_NOT_RUNNING.
    desktopDevInspectServer = null;
    throw error;
  }
}

export async function stopDesktopDevInspectServer(): Promise<void> {
  if (!desktopDevInspectServer) {
    return;
  }

  const server = desktopDevInspectServer;
  desktopDevInspectServer = null;

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
