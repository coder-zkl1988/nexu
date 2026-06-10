import { describe, expect, it } from "vitest";
import { InstallQueue } from "../src/services/skillhub/install-queue.js";

/**
 * Regression guard for the P1 from PR #1074: a single stalled install used
 * to keep the queue's active set non-empty forever, blocking onIdle (and
 * with it the skill->config sync) for every other successful install. The
 * fix adds hard exec timeouts in catalog-manager/npm-runner so a hung child
 * process rejects; these tests pin the queue-side contract that a rejecting
 * executor drains the queue and still lets onIdle fire.
 */
describe("InstallQueue idle drain with failing installs", () => {
  function createQueue(executor: (slug: string) => Promise<void>) {
    let idleCount = 0;
    let resolveIdle: (() => void) | null = null;
    const idleFired = new Promise<void>((resolve) => {
      resolveIdle = resolve;
    });
    const queue = new InstallQueue({
      executor,
      onIdle: () => {
        idleCount += 1;
        resolveIdle?.();
      },
      maxConcurrency: 2,
      cleanupDelayMs: 60_000,
    });
    return { queue, idleFired, getIdleCount: () => idleCount };
  }

  it("fires onIdle when one install rejects (timed-out exec) while another succeeds", async () => {
    const { queue, idleFired, getIdleCount } = createQueue(async (slug) => {
      if (slug === "hung-skill") {
        // What a killed-on-timeout `clawhub install` child surfaces.
        throw new Error("spawn ETIMEDOUT: clawhub install killed by timeout");
      }
    });

    queue.enqueue("ok-skill", "managed");
    queue.enqueue("hung-skill", "managed");
    await idleFired;

    const items = queue.getQueue();
    expect(items.find((i) => i.slug === "ok-skill")?.status).toBe("done");
    expect(items.find((i) => i.slug === "hung-skill")?.status).toBe("failed");
    expect(getIdleCount()).toBe(1);

    queue.dispose();
  });

  it("drains the active set when every install rejects", async () => {
    const failures: string[] = [];
    const { queue } = createQueue(async (slug) => {
      failures.push(slug);
      throw new Error("network unreachable");
    });

    queue.enqueue("a", "managed");
    queue.enqueue("b", "managed");

    await new Promise((resolve) => setTimeout(resolve, 50));

    const items = queue.getQueue();
    expect(failures.sort()).toEqual(["a", "b"]);
    expect(items.every((i) => i.status === "failed")).toBe(true);
    // No successful completion -> no idle sync needed, but nothing may be
    // left "downloading": a fresh enqueue must still be able to execute.
    expect(items.some((i) => i.status === "downloading")).toBe(false);

    queue.dispose();
  });
});
