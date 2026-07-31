import { describe, expect, it } from "vitest";
import { extractMessage } from "../src/lib/chat/chat-message-extract";
import {
  buildTranscriptItems,
  stripRenderedAssistantText,
} from "../src/lib/chat/chat-transcript-groups";

type TestMessage = {
  id: string;
  role: "user" | "assistant";
  content: unknown;
  aborted?: boolean;
};

function entry(msg: TestMessage) {
  return {
    msg,
    extracted: extractMessage(msg as unknown as Record<string, unknown>),
  };
}

describe("buildTranscriptItems", () => {
  it("groups tool rounds and keeps the trailing assistant answer formal", () => {
    const items = buildTranscriptItems([
      entry({ id: "user-1", role: "user", content: "Check the phone" }),
      entry({
        id: "assistant-tool-1",
        role: "assistant",
        content: [
          { type: "text", text: "Checking the current status." },
          { type: "toolCall", id: "call-1", name: "device_get_status" },
        ],
      }),
      entry({
        id: "assistant-tool-2",
        role: "assistant",
        content: [
          { type: "toolCall", id: "call-2", name: "device_cancel_task" },
        ],
      }),
      entry({
        id: "assistant-final",
        role: "assistant",
        content: "The phone is idle now.",
      }),
    ]);

    expect(items.map((item) => item.kind)).toEqual([
      "message",
      "activity",
      "message",
    ]);
    expect(items[1]?.kind).toBe("activity");
    if (items[1]?.kind === "activity") {
      expect(items[1].entries.map(({ msg }) => msg.id)).toEqual([
        "assistant-tool-1",
        "assistant-tool-2",
      ]);
    }
    expect(items[2]?.kind).toBe("message");
    if (items[2]?.kind === "message") {
      expect(items[2].entry.msg.id).toBe("assistant-final");
    }
  });

  it("absorbs text-only narration between tool rounds into the activity group", () => {
    const items = buildTranscriptItems([
      entry({
        id: "tool-1",
        role: "assistant",
        content: [{ type: "toolCall", id: "call-1", name: "exec" }],
      }),
      entry({
        id: "narration",
        role: "assistant",
        content: "The first command finished; checking again.",
      }),
      entry({
        id: "tool-2",
        role: "assistant",
        content: [{ type: "toolCall", id: "call-2", name: "process" }],
      }),
      entry({
        id: "final",
        role: "assistant",
        content: "Everything is complete.",
      }),
    ]);

    expect(items).toHaveLength(2);
    expect(items[0]?.kind).toBe("activity");
    if (items[0]?.kind === "activity") {
      expect(items[0].entries.map(({ msg }) => msg.id)).toEqual([
        "tool-1",
        "narration",
        "tool-2",
      ]);
    }
  });

  it("leaves an ordinary assistant answer outside activity groups", () => {
    const items = buildTranscriptItems([
      entry({
        id: "answer",
        role: "assistant",
        content: "No tools were needed.",
      }),
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("message");
  });

  it("keeps interrupted assistant output inside the activity group", () => {
    const items = buildTranscriptItems([
      entry({
        id: "tool",
        role: "assistant",
        content: [{ type: "toolCall", id: "call-1", name: "exec" }],
      }),
      entry({
        id: "interrupted-narration",
        role: "assistant",
        content: "The repository boundary is confirmed.",
        aborted: true,
      }),
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("activity");
    if (items[0]?.kind === "activity") {
      expect(items[0].entries.map(({ msg }) => msg.id)).toEqual([
        "tool",
        "interrupted-narration",
      ]);
    }
  });

  it("drops a trailing assistant message duplicated by process narration", () => {
    const items = buildTranscriptItems([
      entry({
        id: "tool-1",
        role: "assistant",
        content: [
          { type: "text", text: "Refreshing the device list." },
          { type: "toolCall", id: "call-1", name: "device_list" },
        ],
      }),
      entry({
        id: "tool-2",
        role: "assistant",
        content: [
          { type: "text", text: "Both devices are online." },
          { type: "toolCall", id: "call-2", name: "device_execute_batch" },
        ],
      }),
      entry({
        id: "duplicate-tail",
        role: "assistant",
        content: "Refreshing the device list. Both devices are online.",
      }),
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("activity");
  });

  it("keeps only new text from the trailing assistant reply", () => {
    const items = buildTranscriptItems([
      entry({
        id: "tool",
        role: "assistant",
        content: [
          { type: "text", text: "Refreshing the device list." },
          { type: "toolCall", id: "call-1", name: "device_list" },
        ],
      }),
      entry({
        id: "final",
        role: "assistant",
        content: "Refreshing the device list. Both devices are ready for work.",
      }),
    ]);

    expect(items).toHaveLength(2);
    expect(items[1]?.kind).toBe("message");
    if (items[1]?.kind === "message") {
      expect(items[1].entry.extracted.text).toBe(
        "Both devices are ready for work.",
      );
    }
  });
});

describe("stripRenderedAssistantText", () => {
  it("hides streaming text that is already rendered as process narration", () => {
    expect(
      stripRenderedAssistantText(
        "Refreshing devices now. Both devices are online.",
        ["Refreshing devices now.", "Both devices are online."],
      ),
    ).toBe("");
  });

  it("keeps only the not-yet-rendered final reply", () => {
    expect(
      stripRenderedAssistantText(
        "Refreshing devices now.\nBoth devices are online. Installation has started.",
        ["Refreshing devices now.", "Both devices are online."],
      ),
    ).toBe("Installation has started.");
  });

  it("matches process narration across whitespace differences", () => {
    expect(
      stripRenderedAssistantText(
        "Checking both devices now. Final result: ready.",
        ["Checking   both\n devices now."],
      ),
    ).toBe("Final result: ready.");
  });
});
