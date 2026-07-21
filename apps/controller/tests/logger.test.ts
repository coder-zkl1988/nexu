import { afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "../src/lib/logger.js";

/**
 * Error instances carry message/stack as non-enumerable own properties, so a
 * plain JSON.stringify silently drops them — logger.error({ err }, ...) used
 * to log only `{"name":"..."}` with the actual failure reason lost. The fix
 * expands Error instances found anywhere in the log payload before
 * serialization.
 */
describe("logger error serialization", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("preserves message and stack for a top-level Error field", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = new Error("generation timed out after 240000ms");
    logger.error({ err }, "media generation: unexpected failure");

    expect(spy).toHaveBeenCalledTimes(1);
    const line = spy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(line);
    expect(parsed.err.name).toBe("Error");
    expect(parsed.err.message).toBe("generation timed out after 240000ms");
    expect(typeof parsed.err.stack).toBe("string");
  });

  it("preserves a custom error subclass's name and message", () => {
    class ImageGenerationFailedError extends Error {
      constructor(message: string) {
        super(message);
        this.name = "ImageGenerationFailedError";
      }
    }
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.error(
      {
        err: new ImageGenerationFailedError(
          "generation timed out after 240000ms",
        ),
      },
      "media generation: unexpected failure",
    );

    const parsed = JSON.parse(spy.mock.calls[0]?.[0] as string);
    expect(parsed.err.name).toBe("ImageGenerationFailedError");
    expect(parsed.err.message).toBe("generation timed out after 240000ms");
  });

  it("does not affect plain (non-Error) detail fields", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    logger.warn({ channelId: "c1", gapMs: 42 }, "some warning");

    const parsed = JSON.parse(spy.mock.calls[0]?.[0] as string);
    expect(parsed.channelId).toBe("c1");
    expect(parsed.gapMs).toBe(42);
  });
});
