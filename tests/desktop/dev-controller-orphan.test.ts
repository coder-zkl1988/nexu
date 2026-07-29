import { describe, expect, it, vi } from "vitest";

/**
 * The launcher's controller status must not call an orphan "stopped".
 *
 * A stop that loses its worker leaves a live controller holding the port with
 * no dev lock. Reported as `stopped`, that state is a trap: the desktop
 * preflight refuses to start ("controller is not running") against a
 * controller that is answering `/health`, and nothing in the launcher will
 * ever clean it up. Reported as `stale`, the existing start/stop paths kill
 * the orphan and recover on their own.
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

import { getCurrentControllerDevSnapshot } from "../../tools/dev/src/services/controller";

function enoent(): Error {
  return Object.assign(new Error("no lock file"), { code: "ENOENT" });
}

describe("getCurrentControllerDevSnapshot without a dev lock", () => {
  it("reports an orphan on the controller port as stale, not stopped", async () => {
    readDevLock.mockRejectedValueOnce(enoent());
    getListeningPortPid.mockResolvedValueOnce(4242);

    const snapshot = await getCurrentControllerDevSnapshot();

    expect(snapshot.status).toBe("stale");
    expect(snapshot.workerPid).toBe(4242);
    expect(snapshot.staleReason).toContain("still listening");
  });

  it("reports stopped when nothing holds the port", async () => {
    readDevLock.mockRejectedValueOnce(enoent());
    getListeningPortPid.mockRejectedValueOnce(
      new Error("nothing is listening"),
    );

    const snapshot = await getCurrentControllerDevSnapshot();

    expect(snapshot).toEqual({ service: "controller", status: "stopped" });
  });
});
