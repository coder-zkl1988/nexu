import { describe, expect, it, vi } from "vitest";
import { InstallQueue } from "../src/services/skillhub/install-queue.js";

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("InstallQueue retry after failure", () => {
  it("preserves publisher identity in queue state", () => {
    const queue = new InstallQueue({
      executor: () => new Promise<void>(() => {}),
    });

    const item = queue.enqueue("foo", "managed", "publisher");

    expect(item.ownerHandle).toBe("publisher");
    expect(queue.getQueue()[0]?.ownerHandle).toBe("publisher");
    queue.dispose();
  });

  it("allows a completed slug to be replaced by another publisher", async () => {
    const executor = vi.fn(async () => {});
    const queue = new InstallQueue({ executor, cleanupDelayMs: 10_000 });

    queue.enqueue("foo", "managed", "publisher-a");
    await flush();
    queue.enqueue("foo", "managed", "publisher-b");
    await flush();

    expect(executor).toHaveBeenCalledTimes(2);
    expect(queue.getQueue()).toHaveLength(1);
    expect(queue.getQueue()[0]?.ownerHandle).toBe("publisher-b");
    queue.dispose();
  });

  it("re-enqueues a completed slug for the same publisher when updating", async () => {
    const executor = vi.fn(async () => {});
    const queue = new InstallQueue({ executor, cleanupDelayMs: 10_000 });

    queue.enqueue("foo", "managed", "publisher");
    await flush();
    queue.enqueue("foo", "managed", "publisher", {
      replaceCompleted: true,
    });
    await flush();

    expect(executor).toHaveBeenCalledTimes(2);
    expect(queue.getQueue()).toHaveLength(1);
    expect(queue.getQueue()[0]).toMatchObject({
      slug: "foo",
      ownerHandle: "publisher",
      status: "done",
    });
    queue.dispose();
  });

  it("keeps an in-flight install when an update request arrives", () => {
    const executor = vi.fn(() => new Promise<void>(() => {}));
    const queue = new InstallQueue({ executor });

    const first = queue.enqueue("foo", "managed", "publisher");
    const duplicate = queue.enqueue("foo", "managed", "publisher", {
      replaceCompleted: true,
    });

    expect(executor).toHaveBeenCalledTimes(1);
    expect(duplicate.enqueuedAt).toBe(first.enqueuedAt);
    expect(queue.getQueue()).toHaveLength(1);
    queue.dispose();
  });

  it("refuses to cancel an active update", async () => {
    let finishInstall: (() => void) | undefined;
    const onCancelled = vi.fn();
    const onComplete = vi.fn();
    const queue = new InstallQueue({
      executor: () =>
        new Promise<void>((resolve) => {
          finishInstall = resolve;
        }),
      onCancelled,
      onComplete,
      cleanupDelayMs: 10_000,
    });

    queue.enqueue("foo", "managed", "publisher", {
      operation: "update",
      replaceCompleted: true,
    });

    expect(queue.hasActiveUpdate("foo")).toBe(true);
    expect(queue.cancel("foo")).toBe(false);
    finishInstall?.();
    await flush();

    expect(queue.getQueue()[0]?.status).toBe("done");
    expect(onComplete).toHaveBeenCalledWith("foo", "managed");
    expect(onCancelled).not.toHaveBeenCalled();
    queue.dispose();
  });

  it("clears active cancellation state when the executor rejects", async () => {
    let failInstall: ((error: Error) => void) | undefined;
    const onCancelled = vi.fn();
    const executor = vi
      .fn<(slug: string) => Promise<void>>()
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            failInstall = reject;
          }),
      )
      .mockResolvedValueOnce(undefined);
    const queue = new InstallQueue({
      executor,
      onCancelled,
      cleanupDelayMs: 10_000,
    });

    queue.enqueue("foo", "managed");
    expect(queue.cancel("foo")).toBe(true);
    failInstall?.(new Error("network failed"));
    await flush();

    expect(queue.getQueue()[0]).toMatchObject({
      slug: "foo",
      status: "failed",
      error: "Cancelled",
    });

    queue.enqueue("foo", "managed");
    await flush();

    expect(queue.getQueue()[0]?.status).toBe("done");
    expect(onCancelled).not.toHaveBeenCalled();
    queue.dispose();
  });

  it("marks the item failed when install metadata cannot be recorded", async () => {
    const queue = new InstallQueue({
      executor: vi.fn(async () => {}),
      onComplete: () => {
        throw new Error("ledger unavailable");
      },
      cleanupDelayMs: 10_000,
    });

    queue.enqueue("foo", "managed");
    await flush();

    expect(queue.getQueue()[0]).toMatchObject({
      slug: "foo",
      status: "failed",
      errorCode: "unknown",
      error: "Install completed but could not be recorded: ledger unavailable",
    });
    queue.dispose();
  });

  it("replaces the stale failed entry when the same slug is re-enqueued", async () => {
    const executor = vi
      .fn<(slug: string) => Promise<void>>()
      .mockRejectedValueOnce(
        new Error("Rate limit exceeded. Retry in 0s. Reset in 0s."),
      )
      .mockResolvedValueOnce(undefined);

    const queue = new InstallQueue({
      executor,
      maxConcurrency: 1,
      maxRetries: 1,
      cleanupDelayMs: 10_000,
    });

    queue.enqueue("foo", "managed");
    // Let the first attempt fail and exhaust retries.
    await flush();
    await flush();
    await flush();

    const afterFail = queue.getQueue();
    expect(afterFail).toHaveLength(1);
    expect(afterFail[0]).toMatchObject({
      slug: "foo",
      status: "failed",
      errorCode: "rate_limit",
    });

    // Retry: the stale failed entry must be cleared so the queue reflects
    // only the fresh attempt (no duplicate rows for the same slug).
    queue.enqueue("foo", "managed");
    const afterRetry = queue.getQueue();
    expect(afterRetry).toHaveLength(1);
    expect(afterRetry[0]?.slug).toBe("foo");
    // "queued" if still pending, "downloading" once drain() has fired —
    // either proves the stale failed row was replaced by the fresh attempt.
    expect(["queued", "downloading"]).toContain(afterRetry[0]?.status);

    queue.dispose();
  });

  it("evicts a failed entry when cancel(slug) is called", async () => {
    const executor = vi
      .fn<(slug: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("Skill not found"));

    const queue = new InstallQueue({
      executor,
      maxConcurrency: 1,
      maxRetries: 1,
      cleanupDelayMs: 10_000,
    });

    queue.enqueue("ghost", "managed");
    await flush();
    await flush();

    expect(queue.getQueue()).toHaveLength(1);
    expect(queue.getQueue()[0]?.status).toBe("failed");

    const cancelled = queue.cancel("ghost");
    expect(cancelled).toBe(true);
    expect(queue.getQueue()).toHaveLength(0);

    queue.dispose();
  });

  it("defaults cleanupDelayMs to 60 seconds", () => {
    const queue = new InstallQueue({ executor: vi.fn() });
    // Access private via a narrow cast — the public surface doesn't expose it,
    // but the default is a safety-relevant value worth guarding.
    const delay = (queue as unknown as { cleanupDelayMs: number })
      .cleanupDelayMs;
    expect(delay).toBe(60_000);
    queue.dispose();
  });
});
