import { describe, expect, it } from "vitest";
import { extractMessage } from "../src/lib/chat/chat-message-extract";

const INTERNAL_BLOCK = [
  "<<<BEGIN_OPENCLAW_INTERNAL_CONTEXT>>>",
  "OpenClaw runtime context (internal):",
  "This context is runtime-generated, not user-authored. Keep internal details private.",
  "",
  "[Internal task completion event]",
  "source: subagent",
  "session_key: agent:5128c51f-***:subagent:92cd79a8-***",
  "task: 为短片设计10个关键帧提示词",
  "status: completed; ready for parent review",
  "<<<END_OPENCLAW_INTERNAL_CONTEXT>>>",
].join("\n");

describe("file attachment extraction", () => {
  it("preserves a controller download URL on file blocks", () => {
    const extracted = extractMessage({
      role: "assistant",
      content: [
        {
          type: "file",
          url: "/api/v1/media/state-file?path=%2Ftmp%2Freport.docx",
          metadata: {
            filename: "report.docx",
            mimeType:
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          },
        },
      ],
    });

    expect(extracted.fileCards).toEqual([
      expect.objectContaining({
        name: "report.docx",
        url: "/api/v1/media/state-file?path=%2Ftmp%2Freport.docx",
      }),
    ]);
  });
});

describe("OpenClaw internal-context stripping", () => {
  it("a user message that is only an internal-context block extracts to empty text", () => {
    const extracted = extractMessage({
      role: "user",
      content: [{ type: "text", text: INTERNAL_BLOCK }],
    });
    expect(extracted.text).toBe("");
    expect(extracted.hasToolCall).toBe(false);
    expect(extracted.images).toHaveLength(0);
    expect(extracted.fileCards).toHaveLength(0);
  });

  it("strips an embedded internal-context block but keeps surrounding text", () => {
    const extracted = extractMessage({
      role: "user",
      content: `你好\n${INTERNAL_BLOCK}\n还在吗`,
    });
    expect(extracted.text).not.toContain("OPENCLAW_INTERNAL_CONTEXT");
    expect(extracted.text).toContain("你好");
    expect(extracted.text).toContain("还在吗");
  });

  it("strips an unterminated block (mid-stream) to the end of the text", () => {
    const extracted = extractMessage({
      role: "user",
      content:
        "<<<BEGIN_OPENCLAW_INTERNAL_CONTEXT>>>\npartial internal payload",
    });
    expect(extracted.text).toBe("");
  });

  it("leaves ordinary messages untouched", () => {
    const extracted = extractMessage({
      role: "user",
      content: "普通消息内容",
    });
    expect(extracted.text).toBe("普通消息内容");
  });
});

describe("canvas_op_result round-trip", () => {
  it("detects the machine round-trip and exposes applied/errors, hiding the raw JSON", () => {
    const extracted = extractMessage({
      role: "user",
      content: JSON.stringify({
        type: "canvas_op_result",
        applied: 1,
        errors: ["未找到节点：does-not-exist"],
      }),
    });
    expect(extracted.canvasOpResult).toEqual({
      applied: 1,
      errors: ["未找到节点：does-not-exist"],
    });
    expect(extracted.text).toBe("");
  });

  it("is null for ordinary text that merely mentions the phrase", () => {
    const extracted = extractMessage({
      role: "user",
      content: "canvas_op_result 是什么意思？",
    });
    expect(extracted.canvasOpResult).toBeNull();
    expect(extracted.text).toContain("canvas_op_result");
  });

  it("is null for malformed JSON", () => {
    const extracted = extractMessage({
      role: "user",
      content: '{"type":"canvas_op_result", not valid json',
    });
    expect(extracted.canvasOpResult).toBeNull();
  });

  it("a2ui_action takes priority when a message somehow matches both shapes", () => {
    const extracted = extractMessage({
      role: "user",
      content: JSON.stringify({
        type: "a2ui_action",
        actionName: "confirm",
        data: { canvas_op_result: true },
      }),
    });
    expect(extracted.a2uiAction).toEqual({ actionName: "confirm" });
    expect(extracted.canvasOpResult).toBeNull();
  });
});

describe("execution trace extraction", () => {
  it("preserves every tool call with its id and arguments", () => {
    const extracted = extractMessage({
      role: "assistant",
      content: [
        { type: "text", text: "Checking both devices." },
        {
          type: "toolCall",
          id: "call-1",
          name: "device_get_status",
          arguments: { deviceId: "device-a" },
        },
        {
          type: "tool_use",
          id: "call-2",
          name: "exec",
          input: { command: "sleep 1" },
        },
      ],
    });

    expect(extracted.text).toBe("Checking both devices.");
    expect(extracted.hasToolCall).toBe(true);
    expect(extracted.toolCalls).toEqual([
      {
        id: "call-1",
        name: "device_get_status",
        arguments: { deviceId: "device-a" },
      },
      {
        id: "call-2",
        name: "exec",
        arguments: { command: "sleep 1" },
      },
    ]);
  });

  it("keeps explicit reasoning separate from the user-facing answer text", () => {
    const extracted = extractMessage({
      role: "assistant",
      content: [
        { type: "thinking", thinking: "I should inspect the device first." },
        { type: "reasoning", text: "The previous status may be stale." },
        {
          type: "toolCall",
          id: "call-1",
          name: "device_get_status",
          arguments: {},
        },
      ],
    });

    expect(extracted.text).toBe("");
    expect(extracted.reasoning).toEqual([
      "I should inspect the device first.",
      "The previous status may be stale.",
    ]);
  });
});
