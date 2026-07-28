import { describe, expect, it, vi } from "vitest";
import {
  publishExternalChatInput,
  subscribeExternalChatInput,
} from "../src/lib/chat/external-chat-input";

describe("external chat input", () => {
  it("delivers browser context only to the matching session", () => {
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = subscribeExternalChatInput("session-1", first);
    const unsubscribeSecond = subscribeExternalChatInput("session-2", second);

    publishExternalChatInput("session-1", { text: "selected element" });

    expect(first).toHaveBeenCalledWith({ text: "selected element" });
    expect(second).not.toHaveBeenCalled();
    unsubscribeFirst();
    unsubscribeSecond();
  });

  it("stops delivery after the composer unsubscribes", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeExternalChatInput("session-1", listener);
    unsubscribe();

    publishExternalChatInput("session-1", { text: "ignored" });

    expect(listener).not.toHaveBeenCalled();
  });
});
