import { describe, expect, it } from "vitest";
import { createSurfaceManager } from "../src/lib/a2ui";
import type { A2UIMessage } from "../src/lib/a2ui";
import { coalesceInlineA2UISurfaces } from "../src/lib/chat/chat-a2ui-surfaces";
import { extractMessage } from "../src/lib/chat/chat-message-extract";

function extractedA2UI(messages: A2UIMessage[]) {
  const jsonl = messages.map((message) => JSON.stringify(message)).join("\n");
  return extractMessage({
    role: "assistant",
    content: ["```a2ui", jsonl, "```"].join("\n"),
  });
}

function xhsSurface(surfaceId: string, images: string[]): A2UIMessage {
  return {
    version: "v0.9",
    createSurface: {
      surfaceId,
      catalogId: "https://nexu.app/a2ui/custom-catalog.json",
      components: [
        {
          id: "xhs-editor",
          type: "XHSEditor",
          title: "长高攻略",
          content: "正文",
          hashtags: ["育儿"],
          images,
        } as never,
      ],
    },
  };
}

describe("coalesceInlineA2UISurfaces", () => {
  it("applies a later image update to the original inline XHS surface", () => {
    const initial = xhsSurface("xhs-growth-post", []);
    const updated = xhsSurface("xhs-growth-post", [
      "/api/v1/media/file?path=generated-cover.png",
    ]);
    const other = xhsSurface("xhs-other-post", []);

    const result = coalesceInlineA2UISurfaces([
      { msg: { id: "first" }, extracted: extractedA2UI([initial]) },
      { msg: { id: "update" }, extracted: extractedA2UI([updated]) },
      { msg: { id: "other" }, extracted: extractedA2UI([other]) },
    ]);

    expect(result[0]?.extracted.a2uiMessages).toEqual([initial, updated]);
    expect(result[1]?.extracted.hasA2UI).toBe(false);
    expect(result[1]?.extracted.a2uiMessages).toBeNull();
    expect(result[2]?.extracted.hasA2UI).toBe(true);

    const manager = createSurfaceManager();
    manager.processMessages(result[0]?.extracted.a2uiMessages ?? []);
    const component = manager
      .getSurface("xhs-growth-post")
      ?.components.get("xhs-editor") as { images?: string[] } | undefined;
    expect(component?.images).toEqual([
      "/api/v1/media/file?path=generated-cover.png",
    ]);
  });
});
