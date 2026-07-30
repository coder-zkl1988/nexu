/**
 * Embedded Web Server tests — routing, proxying, auth mock, SPA fallback.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type EmbeddedWebServer,
  startEmbeddedWebServer,
} from "../../apps/desktop/main/services/embedded-web-server";

describe("EmbeddedWebServer", () => {
  let server: EmbeddedWebServer;
  let baseUrl: string;
  let webRoot: string;
  const TEST_PORT = 51777;

  beforeAll(async () => {
    webRoot = mkdtempSync(join(tmpdir(), "nexu-web-test-"));
    writeFileSync(join(webRoot, "index.html"), "<html><body>SPA</body></html>");
    mkdirSync(join(webRoot, "assets"), { recursive: true });
    writeFileSync(join(webRoot, "assets", "style.css"), "body { color: red; }");

    server = await startEmbeddedWebServer({
      port: TEST_PORT,
      webRoot,
      controllerPort: 59999, // no controller running — proxy will fail
    });
    baseUrl = `http://127.0.0.1:${TEST_PORT}`;
  });

  afterAll(async () => {
    await server?.close();
  });

  it("returns mock desktop session for /api/auth/get-session", async () => {
    const res = await fetch(`${baseUrl}/api/auth/get-session`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.user.id).toBe("desktop-local-user");
    expect(body.user.email).toBe("desktop@nexu.local");
    expect(body.session.id).toBe("desktop-local-session");
  });

  it("serves static files with correct MIME type", async () => {
    const res = await fetch(`${baseUrl}/assets/style.css`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/css");

    const body = await res.text();
    expect(body).toBe("body { color: red; }");
  });

  it("falls back to index.html for unknown routes (SPA)", async () => {
    const res = await fetch(`${baseUrl}/some/deep/route`);
    expect(res.status).toBe(200);

    const body = await res.text();
    expect(body).toContain("SPA");
  });

  it("returns 502 when proxying to unavailable controller", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(502);
  });

  it("carries the file:// shell's boot probe to a controller that answers", async () => {
    // The desktop shell renders from file://, so its readiness poll arrives
    // exactly like an attack would: opaque origin, cross-site fetch metadata.
    // Two gates killed it in turn — first this server's edge gate, then, once
    // that learned to admit it, the controller's own global guard re-judging
    // the forwarded browser headers. Either failure leaves the packaged app on
    // the boot screen forever with every unit healthy. This test runs the full
    // two-hop path: a controller stand-in that rejects any browser trust
    // metadata (as the real guard would) and answers ready otherwise.
    const CONTROLLER_STUB_PORT = 51788;
    const PROBE_WEB_PORT = 51789;
    const seenHeaders: Record<string, string | string[] | undefined>[] = [];
    const controller = createServer((req, res) => {
      seenHeaders.push({
        origin: req.headers.origin,
        "sec-fetch-site": req.headers["sec-fetch-site"],
      });
      if (req.headers.origin || req.headers["sec-fetch-site"]) {
        res.writeHead(403).end("Forbidden");
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ready":true}');
    });
    await new Promise<void>((resolve) => {
      controller.listen(CONTROLLER_STUB_PORT, "127.0.0.1", resolve);
    });
    const probeServer = await startEmbeddedWebServer({
      port: PROBE_WEB_PORT,
      webRoot,
      controllerPort: CONTROLLER_STUB_PORT,
    });

    try {
      const res = await fetch(
        `http://127.0.0.1:${PROBE_WEB_PORT}/api/internal/desktop/ready`,
        {
          headers: {
            Origin: "null",
            "Sec-Fetch-Site": "cross-site",
          },
        },
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ready: true });
      // The proxy must have stripped the browser context before forwarding.
      expect(seenHeaders).toEqual([
        { origin: undefined, "sec-fetch-site": undefined },
      ]);
    } finally {
      await probeServer.close();
      await new Promise<void>((resolve) => {
        controller.close(() => resolve());
      });
    }
  });

  it("keeps the boot-probe exception GET-only and path-exact", async () => {
    const post = await fetch(`${baseUrl}/api/internal/desktop/ready`, {
      method: "POST",
      headers: { Origin: "null", "Sec-Fetch-Site": "cross-site" },
    });
    expect(post.status).toBe(403);

    const sibling = await fetch(`${baseUrl}/api/internal/desktop/ready/other`, {
      headers: { Origin: "null", "Sec-Fetch-Site": "cross-site" },
    });
    expect(sibling.status).toBe(403);
  });

  it("rejects cross-origin CORS preflight without reflecting the origin", async () => {
    const res = await fetch(`${baseUrl}/api/test`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://evil.example",
        "Sec-Fetch-Site": "cross-site",
      },
    });
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("rejects cross-origin API posts before they reach the controller", async () => {
    const res = await fetch(
      `${baseUrl}/api/v1/runtime-config/local-automation/computer-use/permissions`,
      {
        method: "POST",
        headers: { Origin: "https://evil.example" },
      },
    );
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("allows same-origin preflight without emitting CORS credentials", async () => {
    const res = await fetch(`${baseUrl}/api/test`, {
      method: "OPTIONS",
      headers: { Origin: baseUrl },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("rejects cross-origin websocket upgrades", async () => {
    const statusCode = await new Promise<number | undefined>(
      (resolve, reject) => {
        const req = httpRequest(`${baseUrl}/api/v1/devices/test/mirror`, {
          headers: {
            Connection: "Upgrade",
            Origin: "https://evil.example",
            Upgrade: "websocket",
          },
        });
        req.on("response", (response) => {
          response.resume();
          resolve(response.statusCode);
        });
        req.on("upgrade", () => reject(new Error("unexpected upgrade")));
        req.on("error", reject);
        req.end();
      },
    );
    expect(statusCode).toBe(403);
  });

  it("prevents path traversal", async () => {
    const res = await fetch(`${baseUrl}/../../../etc/passwd`);
    // Should either serve index.html (SPA fallback) or 403, not the actual file
    expect([200, 403]).toContain(res.status);
    if (res.status === 200) {
      const body = await res.text();
      expect(body).toContain("SPA"); // SPA fallback, not /etc/passwd
    }
  });
});
