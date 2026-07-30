import { describe, expect, it, vi } from "vitest";
import {
  acceptTrustedLocalUpgrade,
  isTrustedLocalRequest,
} from "../src/lib/local-request-guard.js";

describe("local request guard", () => {
  it("accepts loopback hosts and loopback browser origins", () => {
    expect(
      isTrustedLocalRequest({
        host: "127.0.0.1:51800",
        origin: "http://localhost:51810",
        secFetchSite: "same-site",
      }),
    ).toBe(true);
    expect(
      isTrustedLocalRequest({ requestUrl: "http://localhost/api/v1/me" }),
    ).toBe(true);
  });

  it("rejects DNS rebinding hosts and cross-site browser requests", () => {
    expect(
      isTrustedLocalRequest({
        host: "evil.example:51800",
        origin: "http://evil.example:51800",
      }),
    ).toBe(false);
    expect(
      isTrustedLocalRequest({
        host: "localhost.evil.example:51800",
        origin: "http://localhost.evil.example:51800",
      }),
    ).toBe(false);
    expect(
      isTrustedLocalRequest({
        host: "127.0.0.1:51800",
        origin: "https://evil.example",
      }),
    ).toBe(false);
    expect(
      isTrustedLocalRequest({
        host: "127.0.0.1:51800",
        secFetchSite: "cross-site",
      }),
    ).toBe(false);
  });

  it("rejects hostile websocket upgrades before the proxy handles them", () => {
    const socket = { end: vi.fn() };
    const accepted = acceptTrustedLocalUpgrade(
      {
        url: "/api/v1/devices/device-1/mirror",
        headers: {
          host: "evil.example:51800",
          origin: "http://evil.example:51800",
        },
      },
      socket,
    );

    expect(accepted).toBe(false);
    expect(socket.end).toHaveBeenCalledWith(
      expect.stringContaining("403 Forbidden"),
    );
  });
});
