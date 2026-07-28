import { isTrustedLocalRequest } from "@nexu/shared";
import { describe, expect, it } from "vitest";

// The controller port and the desktop embedded web server share this guard and
// differ only by origin policy. These cases pin the policy split and the
// normalization rules that make `same-origin` comparable at all.

describe("isTrustedLocalRequest origin policy", () => {
  it("accepts a cross-port loopback origin only under any-loopback", () => {
    const metadata = {
      host: "127.0.0.1:18760",
      origin: "http://127.0.0.1:5173",
    };
    expect(isTrustedLocalRequest(metadata, "any-loopback")).toBe(true);
    expect(isTrustedLocalRequest(metadata, "same-origin")).toBe(false);
  });

  it("defaults to any-loopback so the controller keeps the Vite dev origin", () => {
    expect(
      isTrustedLocalRequest({
        host: "127.0.0.1:18760",
        origin: "http://localhost:5173",
      }),
    ).toBe(true);
  });

  it("accepts a matching origin under same-origin", () => {
    expect(
      isTrustedLocalRequest(
        { host: "127.0.0.1:8080", origin: "http://127.0.0.1:8080" },
        "same-origin",
      ),
    ).toBe(true);
  });

  it("normalizes default ports and host casing under same-origin", () => {
    // new URL("http://localhost:80").origin drops the default port, so a naive
    // string compare against the raw Host header would reject a same-origin
    // request.
    expect(
      isTrustedLocalRequest(
        { host: "localhost:80", origin: "http://localhost" },
        "same-origin",
      ),
    ).toBe(true);
    expect(
      isTrustedLocalRequest(
        { host: "LOCALHOST:8080", origin: "http://localhost:8080" },
        "same-origin",
      ),
    ).toBe(true);
  });

  it("rejects non-loopback and cross-site requests under both policies", () => {
    for (const policy of ["any-loopback", "same-origin"] as const) {
      expect(
        isTrustedLocalRequest({ host: "evil.example.com" }, policy),
        `${policy} must reject a non-loopback Host`,
      ).toBe(false);
      expect(
        isTrustedLocalRequest(
          { host: "127.0.0.1:8080", secFetchSite: "cross-site" },
          policy,
        ),
        `${policy} must reject a cross-site fetch`,
      ).toBe(false);
      expect(
        isTrustedLocalRequest(
          { host: "127.0.0.1:8080", origin: "https://evil.example.com" },
          policy,
        ),
        `${policy} must reject a remote Origin`,
      ).toBe(false);
    }
  });

  it("treats ::1 as loopback under both policies", () => {
    expect(isTrustedLocalRequest({ host: "[::1]:8080" }, "any-loopback")).toBe(
      true,
    );
    expect(
      isTrustedLocalRequest(
        { host: "[::1]:8080", origin: "http://[::1]:8080" },
        "same-origin",
      ),
    ).toBe(true);
  });

  it("rejects a repeated Host or Origin header", () => {
    expect(
      isTrustedLocalRequest({ host: ["127.0.0.1:8080", "evil.example.com"] }),
    ).toBe(false);
    expect(
      isTrustedLocalRequest({
        host: "127.0.0.1:8080",
        origin: ["http://127.0.0.1:8080", "https://evil.example.com"],
      }),
    ).toBe(false);
  });
});
