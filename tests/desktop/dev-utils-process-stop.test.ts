import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  ensureProcessStopped,
  isProcessRunning,
} from "../../packages/dev-utils/src/process";

/**
 * `ensureProcessStopped` exists because `terminateProcess` only delivers a
 * signal. The dev launcher used to fire SIGTERM at the controller worker and
 * remove the dev lock regardless; a worker that survived the signal became an
 * orphan the launcher reported as `stopped` while it kept serving `/health`,
 * and the desktop preflight then refused to start against it. These tests run
 * real processes and real signals — the escalation path is the point.
 */

// Detached, so the child leads its own process group: the group-kill inside
// terminateProcess/ensureProcessStopped must never target the test runner's.
function spawnChild(script: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", script], {
      detached: true,
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve(child.pid as number);
    });
  });
}

async function waitForRunning(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (isProcessRunning(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`child ${pid} never came up`);
}

describe("ensureProcessStopped", () => {
  it("stops a process that honours SIGTERM", async () => {
    const pid = await spawnChild("setInterval(() => {}, 1000);");
    await waitForRunning(pid);

    await ensureProcessStopped(pid);

    expect(isProcessRunning(pid)).toBe(false);
  });

  it("escalates to SIGKILL when SIGTERM is ignored", async () => {
    // The exact orphan shape: alive, trapping SIGTERM, never exiting.
    const pid = await spawnChild(
      'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);',
    );
    await waitForRunning(pid);

    await ensureProcessStopped(pid, { termTimeoutMs: 500 });

    expect(isProcessRunning(pid)).toBe(false);
  });

  it("returns immediately for a process that is already gone", async () => {
    const pid = await spawnChild("process.exit(0);");
    for (let attempt = 0; attempt < 50 && isProcessRunning(pid); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    await expect(ensureProcessStopped(pid)).resolves.toBeUndefined();
  });
});
