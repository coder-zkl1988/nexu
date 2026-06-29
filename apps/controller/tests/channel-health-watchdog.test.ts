import { describe, expect, it } from "vitest";
import {
  type HealthVerdict,
  MAX_RESTARTS_PER_WINDOW,
  UNHEALTHY_THRESHOLD,
  classifyChannel,
  createChannelHealthEvaluator,
} from "../src/runtime/channel-health-watchdog.js";
import type { ChannelLiveStatusEntry } from "../src/services/openclaw-gateway-service.js";

function entry(
  overrides: Partial<ChannelLiveStatusEntry> = {},
): ChannelLiveStatusEntry {
  return {
    channelType: "feishu",
    channelId: "ch-1",
    accountId: "acc-1",
    status: "connected",
    ready: true,
    connected: true,
    running: true,
    configured: true,
    lastError: null,
    ...overrides,
  };
}

describe("classifyChannel", () => {
  const cases: Array<[string, ChannelLiveStatusEntry, HealthVerdict]> = [
    ["ready channel is healthy", entry({ ready: true }), "healthy"],
    [
      "connecting is transient",
      entry({ ready: false, status: "connecting" }),
      "transient",
    ],
    [
      "restarting is transient",
      entry({ ready: false, status: "restarting" }),
      "transient",
    ],
    [
      "wechat session expired is credential-dead",
      entry({
        channelType: "wechat",
        ready: false,
        running: false,
        status: "error",
        lastError: "session expired",
      }),
      "credential-dead",
    ],
    [
      "wechat not-running (no error) is credential-dead",
      entry({
        channelType: "wechat",
        ready: false,
        running: false,
        status: "disconnected",
        lastError: null,
      }),
      "credential-dead",
    ],
    [
      "logged out is credential-dead",
      entry({
        ready: false,
        status: "error",
        lastError: "Account logged out",
      }),
      "credential-dead",
    ],
    [
      "errored connection (no credential signal) is connection-dead",
      entry({
        ready: false,
        running: true,
        status: "error",
        lastError: "ENOTFOUND open.feishu.cn",
      }),
      "connection-dead",
    ],
    [
      "disconnected (no credential signal) is connection-dead",
      entry({ ready: false, running: false, status: "disconnected" }),
      "connection-dead",
    ],
  ];

  for (const [name, input, expected] of cases) {
    it(name, () => {
      expect(classifyChannel(input)).toBe(expected);
    });
  }
});

describe("createChannelHealthEvaluator", () => {
  const deadFeishu = entry({
    ready: false,
    running: true,
    status: "error",
    lastError: "ENOTFOUND open.feishu.cn",
  });

  it("does not restart before the debounce threshold", () => {
    const { evaluate } = createChannelHealthEvaluator();
    let now = 0;
    for (let i = 1; i < UNHEALTHY_THRESHOLD; i++) {
      const decision = evaluate([deadFeishu], true, now);
      expect(decision.shouldRestart).toBe(false);
      expect(decision.connectionDead[0]?.streak).toBe(i);
      now += 60_000;
    }
  });

  it("restarts once the streak reaches the threshold", () => {
    const { evaluate } = createChannelHealthEvaluator();
    let decision = evaluate([deadFeishu], true, 0);
    decision = evaluate([deadFeishu], true, 60_000);
    decision = evaluate([deadFeishu], true, 120_000);
    expect(decision.shouldRestart).toBe(true);
  });

  it("resets the streak when the channel recovers", () => {
    const { evaluate } = createChannelHealthEvaluator();
    evaluate([deadFeishu], true, 0);
    evaluate([deadFeishu], true, 60_000);
    // Recovered before crossing threshold.
    evaluate([entry({ ready: true })], true, 120_000);
    const decision = evaluate([deadFeishu], true, 180_000);
    expect(decision.shouldRestart).toBe(false);
    expect(decision.connectionDead[0]?.streak).toBe(1);
  });

  it("never restarts for credential-dead channels", () => {
    const { evaluate } = createChannelHealthEvaluator();
    const expired = entry({
      channelType: "wechat",
      accountId: "wx-1",
      ready: false,
      running: false,
      status: "error",
      lastError: "session expired",
    });
    let now = 0;
    for (let i = 0; i < 10; i++) {
      const decision = evaluate([expired], true, now);
      expect(decision.shouldRestart).toBe(false);
      expect(decision.credentialDead).toHaveLength(1);
      now += 60_000;
    }
  });

  it("skips evaluation when the gateway is disconnected", () => {
    const { evaluate } = createChannelHealthEvaluator();
    const decision = evaluate([deadFeishu], false, 0);
    expect(decision.shouldRestart).toBe(false);
    expect(decision.connectionDead).toHaveLength(0);
  });

  it("enforces the cooldown between restarts", () => {
    const { evaluate } = createChannelHealthEvaluator();
    // Drive first restart at t=120s.
    evaluate([deadFeishu], true, 0);
    evaluate([deadFeishu], true, 60_000);
    const first = evaluate([deadFeishu], true, 120_000);
    expect(first.shouldRestart).toBe(true);

    // Streaks were cleared after restart; rebuild to threshold but still
    // inside the cooldown window → suppressed.
    evaluate([deadFeishu], true, 180_000);
    evaluate([deadFeishu], true, 240_000);
    const suppressed = evaluate([deadFeishu], true, 300_000);
    expect(suppressed.shouldRestart).toBe(false);
    expect(suppressed.restartSuppressed).toBe(true);
  });

  it("caps restarts within the rolling window", () => {
    const { evaluate } = createChannelHealthEvaluator();
    let restarts = 0;
    // Tick every minute for ~one window. The channel stays dead the whole
    // time; cooldown spaces restarts ~15min apart, so within a 60-min window
    // no more than MAX_RESTARTS_PER_WINDOW can fire.
    for (let minute = 0; minute < 60; minute++) {
      const decision = evaluate([deadFeishu], true, minute * 60_000);
      if (decision.shouldRestart) restarts++;
    }
    expect(restarts).toBe(MAX_RESTARTS_PER_WINDOW);
  });
});
