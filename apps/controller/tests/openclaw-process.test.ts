import { describe, expect, it } from "vitest";
import {
  OpenClawProcessManager,
  type OpenClawRuntimeEvent,
} from "../src/runtime/openclaw-process.js";

/**
 * Drive the private `emitRuntimeEventFromLine` path via the public
 * `onRuntimeEvent` listener, without spawning a real child process.
 */
function createTestHarness() {
  const events: OpenClawRuntimeEvent[] = [];
  const manager = new OpenClawProcessManager({
    manageOpenclawProcess: false,
  } as unknown as Parameters<typeof OpenClawProcessManager>[0] extends never
    ? never
    : Parameters<typeof OpenClawProcessManager>[0]);

  manager.onRuntimeEvent((event) => {
    events.push(event);
  });

  // Reach into the private method via casting so we can unit-test the parser
  // without launching an actual process.
  const emitLine = (line: string) => {
    (
      manager as unknown as {
        emitRuntimeEventFromLine(line: string): void;
      }
    ).emitRuntimeEventFromLine(line);
  };

  return { events, emitLine };
}

describe("OpenClawProcessManager log event parsing", () => {
  it("emits an event when a log line contains the NEXU_EVENT marker", () => {
    const { events, emitLine } = createTestHarness();

    emitLine(
      '2026-04-03T16:48:52.190+08:00 [feishu] NEXU_EVENT channel.reply_outcome {"channel":"feishu","status":"ok"}',
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event: "channel.reply_outcome",
      payload: { channel: "feishu", status: "ok" },
    });
  });

  it("re-pushes the VLM credential via the registered callback after restart", async () => {
    // manageOpenclawProcess:true takes the managed restart branch; stub
    // start()/stop() so no real process is spawned.
    const manager = new OpenClawProcessManager({
      manageOpenclawProcess: true,
    } as unknown as ConstructorParameters<typeof OpenClawProcessManager>[0]);
    const internal = manager as unknown as {
      start(): void;
      stop(): Promise<void>;
    };
    internal.start = () => {};
    internal.stop = async () => {};

    let repushCount = 0;
    manager.setVlmCredentialRepush(async () => {
      repushCount += 1;
    });

    await manager.restart("test_reason");

    expect(repushCount).toBe(1);
  });

  it("restart does not throw when no VLM-credential repush is registered", async () => {
    const manager = new OpenClawProcessManager({
      manageOpenclawProcess: true,
    } as unknown as ConstructorParameters<typeof OpenClawProcessManager>[0]);
    const internal = manager as unknown as {
      start(): void;
      stop(): Promise<void>;
    };
    internal.start = () => {};
    internal.stop = async () => {};

    await expect(manager.restart("no_callback")).resolves.toBeUndefined();
  });

  it("does not emit events for provider or unrelated log lines", () => {
    const { events, emitLine } = createTestHarness();

    // These are the kinds of log lines that the removed
    // createOpenClawLogEventProcessor used to synthesise feishu failure events
    // from. Since that function was removed (commit 642610980), the
    // OpenClawProcessManager no longer synthesises events from arbitrary log
    // lines — only lines that carry an explicit NEXU_EVENT marker are
    // forwarded.
    emitLine(
      "2026-04-03T16:48:52.190+08:00 [feishu] feishu[acc-1]: received message from ou_user in oc_123 (p2p)",
    );
    emitLine(
      "2026-04-03T16:48:52.206+08:00 [feishu] feishu[acc-1]: dispatching to agent (session=sess-1)",
    );
    emitLine(
      "2026-04-03T16:48:52.563+08:00 [agent/embedded] embedded run agent end: runId=run-1 isError=true error=429 [code=insufficient_credits] insufficient credits",
    );
    emitLine(
      "2026-04-03T16:48:53.563+08:00 [agent/embedded] embedded run agent end: runId=run-1 isError=true error=Context overflow: prompt too large for the model.",
    );
    emitLine(
      "2026-04-03T16:48:54.563+08:00 [openclaw] some unrelated error happened",
    );

    expect(events).toHaveLength(0);
  });
});
