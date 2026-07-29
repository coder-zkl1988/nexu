/**
 * Embedded Web Server for Nexu Desktop
 *
 * Serves static files and proxies API requests to the Controller.
 * Runs in the Electron main process, eliminating the need for a separate Web sidecar.
 */

import { createReadStream } from "node:fs";
import { constants, access, stat } from "node:fs/promises";
import {
  type IncomingMessage,
  type ServerResponse,
  createServer,
  request as httpRequest,
} from "node:http";
import * as path from "node:path";
import { Readable, pipeline } from "node:stream";
import { isTrustedLocalRequest as isTrustedLocalRequestMetadata } from "@nexu/shared";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".eot": "application/vnd.ms-fontobject",
};

// The renderer and the proxied API share one loopback origin here, so this
// server pins itself to `same-origin`. The shared implementation is the same
// one the controller port uses; only the origin policy differs.
function isTrustedLocalRequest(req: IncomingMessage): boolean {
  if (!req.headers.host) return false;
  return isTrustedLocalRequestMetadata(
    {
      requestUrl: req.url,
      host: req.headers.host,
      origin: req.headers.origin,
      secFetchSite: req.headers["sec-fetch-site"],
    },
    "same-origin",
  );
}

function rejectUntrustedRequest(res: ServerResponse): void {
  res.writeHead(403, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength("Forbidden"),
  });
  res.end("Forbidden");
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function collectBody(req: IncomingMessage): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const buffer = Buffer.concat(chunks);
  // Convert to Uint8Array for fetch compatibility
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

async function proxyToController(
  req: IncomingMessage,
  res: ServerResponse,
  controllerUrl: string,
): Promise<void> {
  const targetUrl = `${controllerUrl}${req.url}`;

  try {
    let body: Uint8Array | undefined;
    if (req.method !== "GET" && req.method !== "HEAD") {
      body = await collectBody(req);
    }

    // Forward headers, filtering out host and browser trust metadata. The
    // trust decision for this hop was already made at this server's edge gate
    // (same-origin policy, stricter than the controller's own); the forwarded
    // request is server-to-server on loopback. Passing Origin/Sec-Fetch-*
    // through makes the controller's global guard re-judge the *original*
    // browser context — measured: the file:// shell's boot probe cleared the
    // edge gate here and then died 403 at the controller, leaving the packaged
    // app on the boot screen with every unit healthy, exactly as before the
    // edge gate learned to admit it.
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      const name = key.toLowerCase();
      if (name === "host" || name === "origin" || name.startsWith("sec-fetch-"))
        continue;
      if (typeof value === "string") {
        headers[key] = value;
      } else if (Array.isArray(value)) {
        headers[key] = value.join(", ");
      }
    }

    const response = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: body as BodyInit | undefined,
    });

    // Forward response headers
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    res.writeHead(response.status, responseHeaders);
    // Stream the body through instead of buffering it with arrayBuffer().
    // SSE endpoints (e.g. /api/v1/devices/stream) never "end", so awaiting the
    // full body would hang forever and no events would ever reach the client.
    // Use pipeline (not .pipe): the upstream fetch stream rejects with
    // "terminated" when the controller socket closes mid-flight — e.g. on app
    // quit while an SSE stream is open. With .pipe that error is unhandled and
    // crashes the main process ("A JavaScript error occurred…"); pipeline routes
    // it to the callback and tears both streams down cleanly.
    if (response.body) {
      pipeline(
        Readable.fromWeb(
          response.body as Parameters<typeof Readable.fromWeb>[0],
        ),
        res,
        () => {
          // Expected on client disconnect / controller socket close; swallow so
          // it never becomes an uncaught exception in the main process.
        },
      );
    } else {
      res.end();
    }
  } catch (err) {
    console.error("Proxy error:", err);
    if (!res.headersSent) {
      res.writeHead(502);
      res.end("Bad Gateway");
    } else if (!res.destroyed) {
      res.destroy();
    }
  }
}

export interface EmbeddedWebServerOptions {
  port: number;
  webRoot: string;
  controllerPort: number;
}

export interface EmbeddedWebServer {
  /** Actual port the server is listening on (may differ from requested if OS-assigned). */
  port: number;
  close: () => Promise<void>;
}

/**
 * Start the embedded web server.
 */
export function startEmbeddedWebServer(
  opts: EmbeddedWebServerOptions,
): Promise<EmbeddedWebServer> {
  const { port, webRoot, controllerPort } = opts;
  const controllerUrl = `http://127.0.0.1:${controllerPort}`;

  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${port}`);
      const isApiRequest =
        url.pathname.startsWith("/api") ||
        url.pathname.startsWith("/v1") ||
        url.pathname === "/openapi.json";

      // The desktop shell renders from file://, so its boot probe of the ready
      // endpoint arrives as a cross-site GET with an opaque origin — the exact
      // shape the trust gate rejects. It is also the one request that has to
      // succeed before anything same-origin exists to send it: the shell only
      // mounts the web surface once this answers, so gating it left the
      // packaged app permanently on the boot screen with every unit healthy.
      // GET-only and disclosure-free (readiness state, no secrets), with the
      // loopback-host requirement still applied below.
      const isBootReadyProbe =
        req.method === "GET" &&
        url.pathname === "/api/internal/desktop/ready" &&
        isTrustedLocalRequestMetadata(
          { requestUrl: req.url, host: req.headers.host ?? "" },
          "same-origin",
        );

      // The embedded renderer and API share one loopback origin. Reject browser
      // requests from every other origin instead of exposing the unauthenticated
      // local controller through reflective CORS or DNS rebinding.
      if (isApiRequest && !isBootReadyProbe && !isTrustedLocalRequest(req)) {
        rejectUntrustedRequest(res);
        return;
      }
      if (req.method === "OPTIONS") {
        res.writeHead(isApiRequest ? 204 : 405);
        res.end();
        return;
      }

      // Desktop local auth — better-auth client calls /api/auth/get-session
      // but there's no better-auth server in launchd mode. Return a mock
      // desktop session so the web app proceeds past AuthLayout.
      if (url.pathname === "/api/auth/get-session") {
        const body = JSON.stringify({
          session: {
            id: "desktop-local-session",
            expiresAt: "2099-01-01T00:00:00.000Z",
          },
          user: {
            id: "desktop-local-user",
            email: "desktop@nexu.local",
            name: "Desktop User",
            image: null,
          },
        });
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        });
        res.end(body);
        return;
      }

      // API proxy -> Controller (including /openapi.json)
      if (isApiRequest) {
        return proxyToController(req, res, controllerUrl);
      }

      // Static files — sanitize to prevent path traversal
      const normalized = path
        .normalize(url.pathname)
        .replace(/^(\.\.[/\\])+/, "");
      let filePath = path.join(webRoot, normalized);
      if (!filePath.startsWith(webRoot)) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }

      // SPA fallback: if file doesn't exist or is directory, serve index.html
      const exists = await fileExists(filePath);
      if (!exists) {
        filePath = path.join(webRoot, "index.html");
      } else {
        try {
          const st = await stat(filePath);
          if (st.isDirectory()) {
            filePath = path.join(webRoot, "index.html");
          }
        } catch {
          filePath = path.join(webRoot, "index.html");
        }
      }

      const ext = path.extname(filePath);
      const contentType = MIME_TYPES[ext] || "application/octet-stream";

      try {
        const st = await stat(filePath);
        res.writeHead(200, {
          "Content-Type": contentType,
          "Content-Length": st.size,
        });
        createReadStream(filePath).pipe(res);
      } catch {
        res.writeHead(404);
        res.end("Not Found");
      }
    });

    // Proxy WebSocket upgrades (e.g. the device mirror at
    // /api/v1/devices/{id}/mirror) to the controller. Without this, browser
    // mirror/control sockets terminate at the embedded server and never reach
    // the controller's DeviceMirrorProxy, so no frames flow (the plugin logs
    // forwarders=0) and the screen mirror stays blank.
    server.on("upgrade", (req, clientSocket, head) => {
      const reqUrl = req.url ?? "/";
      if (!(reqUrl.startsWith("/api") || reqUrl.startsWith("/v1"))) {
        clientSocket.destroy();
        return;
      }
      if (!isTrustedLocalRequest(req)) {
        clientSocket.end(
          "HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
        );
        return;
      }

      const proxyReq = httpRequest({
        hostname: "127.0.0.1",
        port: controllerPort,
        path: reqUrl,
        method: req.method ?? "GET",
        headers: req.headers,
      });

      proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
        const headerLines = Object.entries(proxyRes.headers).flatMap(
          ([k, v]) =>
            Array.isArray(v)
              ? v.map((vv) => `${k}: ${vv}`)
              : [`${k}: ${v as string}`],
        );
        clientSocket.write(
          `HTTP/1.1 ${proxyRes.statusCode} ${proxyRes.statusMessage}\r\n${headerLines.join("\r\n")}\r\n\r\n`,
        );
        // Replay any bytes buffered past the handshake in both directions.
        if (proxyHead?.length) clientSocket.write(proxyHead);
        if (head?.length) proxySocket.write(head);
        proxySocket.pipe(clientSocket);
        clientSocket.pipe(proxySocket);
        const cleanup = () => {
          proxySocket.destroy();
          clientSocket.destroy();
        };
        proxySocket.on("error", cleanup);
        clientSocket.on("error", cleanup);
      });

      proxyReq.on("error", () => clientSocket.destroy());
      proxyReq.end();
    });

    server.on("error", (err) => {
      reject(err);
    });

    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : port;
      console.log(
        `Embedded web server listening on http://127.0.0.1:${actualPort}`,
      );
      resolve({
        port: actualPort,
        close: () =>
          new Promise<void>((closeResolve, closeReject) => {
            server.close((err) => {
              if (err) closeReject(err);
              else closeResolve();
            });
          }),
      });
    });
  });
}
