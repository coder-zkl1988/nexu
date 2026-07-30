import type { AgentBrowserSnapshot } from "@nexu/shared";
import { describe, expect, it } from "vitest";
import {
  buildObservation,
  drainFrames,
  parseCommandFrame,
  parseRunEndedFrame,
} from "../../apps/desktop/main/services/agent-browser-protocol";

const snapshot = (
  url: string,
  nodes: AgentBrowserSnapshot["nodes"] = [],
): AgentBrowserSnapshot => ({ url, title: "Page", truncated: false, nodes });

describe("parseCommandFrame", () => {
  it("reads a command envelope", () => {
    const frame = [
      "event: command",
      `data: ${JSON.stringify({
        requestId: "r1",
        sessionKey: "agent:bot:main",
        command: { action: "snapshot" },
      })}`,
    ].join("\n");

    expect(parseCommandFrame(frame)).toEqual({
      requestId: "r1",
      sessionKey: "agent:bot:main",
      command: { action: "snapshot" },
    });
  });

  it("ignores the stream's own keepalive traffic", () => {
    // The controller sends `connected` and `ping` on the same stream; treating
    // either as a command would dispatch garbage into the browser.
    expect(parseCommandFrame("event: ping\ndata: ping")).toBeNull();
    expect(parseCommandFrame("event: connected\ndata: connected")).toBeNull();
    expect(parseCommandFrame("event: command\ndata: not-json")).toBeNull();
    expect(parseCommandFrame("event: command")).toBeNull();
  });
});

describe("parseRunEndedFrame", () => {
  it("reads a run-ended signal and rejects everything else", () => {
    expect(
      parseRunEndedFrame(
        'event: run-ended\ndata: {"sessionKey":"agent:bot:main"}',
      ),
    ).toEqual({ sessionKey: "agent:bot:main" });
    // A command frame is not a run end; treating one as the other would
    // release the panel pin mid-task.
    expect(
      parseRunEndedFrame('event: command\ndata: {"sessionKey":"x"}'),
    ).toBeNull();
    expect(parseRunEndedFrame("event: run-ended\ndata: not-json")).toBeNull();
  });
});

describe("drainFrames", () => {
  it("keeps a partial frame for the next chunk", () => {
    // A command split across two TCP reads must not be parsed as two halves.
    const first = drainFrames("event: command\ndata: {}\n\nevent: com");
    expect(first.frames).toEqual(["event: command\ndata: {}"]);
    expect(first.rest).toBe("event: com");

    const second = drainFrames(`${first.rest}mand\ndata: {}\n\n`);
    expect(second.frames).toEqual(["event: command\ndata: {}"]);
    expect(second.rest).toBe("");
  });
});

describe("buildObservation", () => {
  it("reports the element that was acted on when the page stayed put", () => {
    const element = { ref: "e7", role: "textbox", name: "Search", depth: 3 };
    const observation = buildObservation(
      snapshot("https://example.com/", [
        { ...element, value: "badminton" },
        { ref: "e8", role: "button", name: "Go", depth: 3 },
      ]),
      "e7",
      "https://example.com/",
    );

    expect(observation.navigated).toBe(false);
    expect(observation.element?.value).toBe("badminton");
  });

  it("reports no element once a navigation has reset the refs", () => {
    // e5 on the new page is a different element entirely. Returning it would
    // answer "here is what you acted on" with something never touched — the
    // exact false evidence this observation exists to rule out.
    const observation = buildObservation(
      snapshot("https://iana.org/", [
        { ref: "e5", role: "image", name: "Homepage", depth: 7 },
      ]),
      "e5",
      "https://example.com/",
    );

    expect(observation.navigated).toBe(true);
    expect(observation.element).toBeUndefined();
  });

  it("reports no element when the click removed it", () => {
    const observation = buildObservation(
      snapshot("https://example.com/", []),
      "e7",
      "https://example.com/",
    );

    expect(observation.navigated).toBe(false);
    expect(observation.element).toBeUndefined();
  });
});
