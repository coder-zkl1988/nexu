import { describe, expect, it, vi } from "vitest";

/**
 * The launcher's web status must not call an orphan "stopped".
 *
 * A stop that loses its listener leaves a live web dev server holding the
 * port with no dev lock. Reported as `stopped`, that state is a trap: nothing
 * in the launcher will ever clean it up, and the next start collides with the
 * occupied port. Reported as `stale`, the existing start/stop paths kill the
 * orphan and recover on their own.
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

import { getCurrentWebDevSnapshot } from "../../tools/dev/src/services/web";

function enoent(): Error {
  return Object.assign(new Error("no lock file"), { code: "ENOENT" });
}

describe("getCurrentWebDevSnapshot without a dev lock", () => {
  it("reports an orphan on the web port as stale, not stopped", async () => {
    readDevLock.mockRejectedValueOnce(enoent());
    getListeningPortPid.mockResolvedValueOnce(4242);

    const snapshot = await getCurrentWebDevSnapshot();

    expect(snapshot.status).toBe("stale");
    expect(snapshot.listenerPid).toBe(4242);
    expect(snapshot.staleReason).toContain("still listening");
  });

  it("reports stopped when nothing holds the port", async () => {
    readDevLock.mockRejectedValueOnce(enoent());
    getListeningPortPid.mockRejectedValueOnce(
      new Error("nothing is listening"),
    );

    const snapshot = await getCurrentWebDevSnapshot();

    expect(snapshot).toEqual({ service: "web", status: "stopped" });
  });
});
