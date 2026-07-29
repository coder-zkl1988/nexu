import { describe, expect, it } from "vitest";
import {
  acceptSteerRunHandoff,
  beginSteerRunHandoff,
  consumePreviousRunAbort,
  consumeReplacementRunTerminal,
} from "../src/lib/chat/steer-run-handoff";

describe("Steer run handoff", () => {
  it("preserves the replacement run when the previous run aborts first", () => {
    const handoff = beginSteerRunHandoff("old-run");

    expect(consumePreviousRunAbort(handoff, "old-run")).toBe(true);
    acceptSteerRunHandoff(handoff, "replacement-run");

    expect(handoff).toEqual({
      previousRunId: "old-run",
      replacementRunId: "replacement-run",
      previousRunAborted: true,
      replacementRunTerminated: false,
      accepted: true,
    });
  });

  it("ignores a late previous-run abort after accepting the replacement", () => {
    const handoff = beginSteerRunHandoff("old-run");

    acceptSteerRunHandoff(handoff, "replacement-run");

    expect(consumePreviousRunAbort(handoff, "old-run")).toBe(true);
    expect(consumePreviousRunAbort(handoff, "replacement-run")).toBe(false);
  });

  it("claims the first primary abort when the previous run id is unknown", () => {
    const handoff = beginSteerRunHandoff(null);

    expect(consumePreviousRunAbort(handoff, "external-run")).toBe(true);
    expect(consumePreviousRunAbort(handoff, "other-run")).toBe(false);
  });

  it("does not consume an unrelated abort when the previous run is known", () => {
    const handoff = beginSteerRunHandoff("old-run");

    expect(consumePreviousRunAbort(handoff, "cron-run")).toBe(false);
    expect(handoff.previousRunAborted).toBe(false);
  });

  it("captures a replacement final that arrives before the steer response", () => {
    const handoff = beginSteerRunHandoff("old-run");

    expect(consumePreviousRunAbort(handoff, "old-run")).toBe(true);
    expect(consumeReplacementRunTerminal(handoff, "replacement-run")).toBe(
      true,
    );
    acceptSteerRunHandoff(handoff, "replacement-run");

    expect(handoff.replacementRunId).toBe("replacement-run");
    expect(handoff.replacementRunTerminated).toBe(true);
  });

  it("does not mistake a terminal event before the old abort for replacement", () => {
    const handoff = beginSteerRunHandoff("old-run");

    expect(consumeReplacementRunTerminal(handoff, "cron-run")).toBe(false);
    expect(handoff.replacementRunTerminated).toBe(false);
  });
});
