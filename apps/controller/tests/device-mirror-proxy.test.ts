import { describe, expect, it } from "vitest";
import { isMirrorChannelTextFrame } from "../src/services/device-mirror-proxy.js";

/**
 * The control bridge shares one upstream socket with the video bridge, so it
 * sees the mirror channel's TEXT frames too. Those must not reach the browser's
 * control socket: on the awaiting-authorization path the phone streams STABLE's
 * JPEG-over-JSON fallback, and forwarding it would make the client JSON.parse
 * hundreds of KB of base64 per frame just to discard it.
 */
describe("isMirrorChannelTextFrame", () => {
  it("detects the STABLE JPEG-over-JSON fallback frame", () => {
    const frame = JSON.stringify({
      channel: "mirror",
      type: "realtime",
      data: "A".repeat(200_000),
    });
    expect(isMirrorChannelTextFrame(frame)).toBe(true);
    expect(isMirrorChannelTextFrame(Buffer.from(frame, "utf8"))).toBe(true);
  });

  it("detects mirror-channel lifecycle frames too", () => {
    const frame = JSON.stringify({
      channel: "mirror",
      type: "device_disconnected",
      deviceId: "d1",
    });
    expect(isMirrorChannelTextFrame(frame)).toBe(true);
  });

  it("lets channel-less control messages through", () => {
    // tabby-control sends errors without a `channel` key; the control client
    // needs them.
    const err = JSON.stringify({ type: "error", code: "AUTH_FAILED" });
    expect(isMirrorChannelTextFrame(err)).toBe(false);
    expect(isMirrorChannelTextFrame(Buffer.from(err, "utf8"))).toBe(false);
  });

  it("only reads the head — a huge payload is classified without decoding it", () => {
    // The marker sits in the first 20 bytes; the rest is never touched.
    const huge = Buffer.from(
      `{"channel":"mirror","type":"realtime","data":"${"B".repeat(1_000_000)}"}`,
      "utf8",
    );
    expect(isMirrorChannelTextFrame(huge)).toBe(true);
  });

  it("fails open when the marker falls outside the scanned head", () => {
    // Deliberate: a frame we cannot classify cheaply is forwarded rather than
    // dropped, because losing a control message is worse than forwarding a
    // video frame. This test documents the trade-off — it is not a wish.
    const reordered = JSON.stringify({
      deviceId: "d".repeat(80),
      channel: "mirror",
      type: "realtime",
    });
    expect(isMirrorChannelTextFrame(reordered)).toBe(false);
  });
});
