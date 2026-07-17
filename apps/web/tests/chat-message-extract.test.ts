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
