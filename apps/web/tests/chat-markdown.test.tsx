import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  ChatMarkdown,
  getEmbeddedBrowserChatLink,
} from "../src/components/ui/chat-markdown";

describe("ChatMarkdown links", () => {
  it("routes only absolute HTTP(S) links to the embedded browser", () => {
    expect(getEmbeddedBrowserChatLink("https://example.com/path")).toBe(
      "https://example.com/path",
    );
    expect(getEmbeddedBrowserChatLink("http://127.0.0.1:4173/")).toBe(
      "http://127.0.0.1:4173/",
    );
    expect(getEmbeddedBrowserChatLink("/relative/path")).toBeNull();
    expect(getEmbeddedBrowserChatLink("mailto:user@example.com")).toBeNull();
    expect(getEmbeddedBrowserChatLink("javascript:alert(1)")).toBeNull();
  });

  it("preserves safe external-link markup with and without the optional callback", () => {
    const content = "[Example](https://example.com/path)";
    const defaultMarkup = renderToStaticMarkup(
      <ChatMarkdown content={content} />,
    );
    const callbackMarkup = renderToStaticMarkup(
      <ChatMarkdown content={content} onOpenLink={vi.fn()} />,
    );

    for (const markup of [defaultMarkup, callbackMarkup]) {
      expect(markup).toContain('target="_blank"');
      expect(markup).toContain('rel="noopener noreferrer nofollow"');
      expect(markup).toContain('href="https://example.com/path"');
    }
  });
});
