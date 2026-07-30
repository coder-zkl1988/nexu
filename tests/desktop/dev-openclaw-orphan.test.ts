import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The launcher's openclaw status must not call an orphan "stopped".
 *
 * A stop that loses a process leaves a live openclaw holding the gateway port
 * with no dev lock. A lockless listener that answers `/health` is an
 * externally managed openclaw the launcher attaches to (`running`), but an
 * unhealthy one is an orphan — reported as `stopped`, nothing in the launcher
 * will ever clean it up, and the next start collides with the occupied port.
 * Reported as `stale`, the existing stop path kills the orphan and recovers.
 */

const readDevLock = vi.fn();
const getListeningPortPid = vi.fn();

vi.mock("@nexu/dev-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nexu/dev-utils")>();
  return {
    ...actual,
    readDevLock: (...args: unknown[]) => readDevLock(...args),
    getListeningPortPid: (...args: unknown[]) => getListeningPortPid(...args),
  };
});

import { getCurrentOpenclawDevSnapshot } from "../../tools/dev/src/services/openclaw";

function enoent(): Error {
  return Object.assign(new Error("no lock file"), { code: "ENOENT" });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getCurrentOpenclawDevSnapshot without a dev lock", () => {
  it("reports an unhealthy orphan on the openclaw port as stale, not stopped", async () => {
    readDevLock.mockRejectedValueOnce(enoent());
    getListeningPortPid.mockResolvedValueOnce(4242);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED")),
    );

    const snapshot = await getCurrentOpenclawDevSnapshot();

    expect(snapshot.status).toBe("stale");
    expect(snapshot.listenerPid).toBe(4242);
    expect(snapshot.staleReason).toContain("still listening");
  });

  it("still attaches to a healthy lockless listener as running", async () => {
    readDevLock.mockRejectedValueOnce(enoent());
    getListeningPortPid.mockResolvedValueOnce(4242);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
    );

    const snapshot = await getCurrentOpenclawDevSnapshot();

    expect(snapshot.status).toBe("running");
    expect(snapshot.listenerPid).toBe(4242);
  });

  it("reports stopped when nothing holds the port", async () => {
    readDevLock.mockRejectedValueOnce(enoent());
    getListeningPortPid.mockRejectedValueOnce(
      new Error("nothing is listening"),
    );

    const snapshot = await getCurrentOpenclawDevSnapshot();

    expect(snapshot).toEqual({ service: "openclaw", status: "stopped" });
  });
});
