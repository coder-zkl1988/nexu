import { describe, expect, it, vi } from "vitest";
import type { AttachmentStore } from "../src/services/attachment-store.js";
import { ChatService } from "../src/services/chat-service.js";
import type { OpenClawGatewayService } from "../src/services/openclaw-gateway-service.js";
import {
  SessionBusyError,
  SessionRunRegistry,
} from "../src/services/session-run-registry.js";

function makeService(
  sendToMainSession: OpenClawGatewayService["sendToMainSession"],
): { service: ChatService; registry: SessionRunRegistry } {
  const registry = new SessionRunRegistry();
  const gatewayService = { sendToMainSession } satisfies Pick<
    OpenClawGatewayService,
    "sendToMainSession"
  >;
  const service = new ChatService(
    gatewayService as unknown as OpenClawGatewayService,
    {} as unknown as AttachmentStore,
    registry,
  );
  return { service, registry };
}

function buildService(isTeamLead?: (botId: string) => boolean) {
  const sendToMainSession = vi.fn(async () => ({
    runId: "run-1",
    messageId: "message-1",
    content: null,
  }));
  const gatewayService = {
    sendToMainSession,
  } satisfies Pick<OpenClawGatewayService, "sendToMainSession">;
  const service = new ChatService(
    gatewayService as unknown as OpenClawGatewayService,
    {} as unknown as AttachmentStore,
    new SessionRunRegistry(),
    isTeamLead,
  );
  return { service, sendToMainSession };
}

function sentMessage(sendToMainSession: ReturnType<typeof vi.fn>): string {
  const call = sendToMainSession.mock.calls[0]?.[0] as
    | { message: string }
    | undefined;
  return call?.message ?? "";
}

describe("ChatService", () => {
  it("preserves the OpenClaw runId from chat.send", async () => {
    const { service } = makeService(async () => ({
      runId: "run-1",
      messageId: "message-1",
      content: null,
    }));

    const result = await service.sendLocalMessage("bot-1", {
      type: "text",
      content: "hello",
    });

    expect(result).toMatchObject({
      id: "message-1",
      runId: "run-1",
    });
  });

  it("injects the expert-routing hint for regular bots", async () => {
    const { service, sendToMainSession } = buildService(() => false);

    await service.sendLocalMessage("bot-1", { type: "text", content: "hi" });

    const message = sentMessage(sendToMainSession);
    expect(message).toMatch(/^\[路由提示：/);
    expect(message).toContain("find_expert");
    // Plain bots get teamless dispatch, not the lead-only tool.
    expect(message).toContain("expert_run_auto");
    expect(message).not.toContain("team_run_auto");
  });

  it("injects the team-lead hint for a lead bot instead of expert routing", async () => {
    const { service, sendToMainSession } = buildService(
      (botId) => botId === "bot-lead",
    );

    await service.sendLocalMessage("bot-lead", {
      type: "text",
      content: "帮团队写一篇笔记",
    });

    const message = sentMessage(sendToMainSession);
    expect(message).toMatch(/^\[路由提示：/);
    expect(message).toContain("team_run_auto");
    expect(message).toContain("team_run_workflow");
    expect(message).not.toContain("find_expert");
  });

  it("keeps a2ui action round-trips verbatim (no hint) even for leads", async () => {
    const { service, sendToMainSession } = buildService(() => true);

    const body = JSON.stringify({
      type: "a2ui_action",
      actionName: "install_expert",
      data: {},
    });
    await service.sendLocalMessage("bot-lead", {
      type: "text",
      content: body,
    });

    expect(sentMessage(sendToMainSession)).toBe(body);
  });

  it("rejects a second local message while a run is active, without re-calling the gateway", async () => {
    let sends = 0;
    const { service, registry } = makeService(async () => {
      sends += 1;
      return { runId: "run-1", messageId: "m1", content: null };
    });

    await service.sendLocalMessage("bot-1", { type: "text", content: "hi" });
    expect(sends).toBe(1);
    expect(registry.isBusy("agent:bot-1:main")).toBe(true);

    await expect(
      service.sendLocalMessage("bot-1", { type: "text", content: "again" }),
    ).rejects.toBeInstanceOf(SessionBusyError);
    expect(sends).toBe(1);
  });

  it("maps a raw 'session file locked' gateway error to SessionBusyError and releases the mark", async () => {
    const { service, registry } = makeService(async () => {
      throw new Error(
        "Agent failed before reply: session file locked (timeout 60000ms): pid=1 alive=true ageMs=1 /x.jsonl.lock",
      );
    });

    await expect(
      service.sendLocalMessage("bot-2", { type: "text", content: "hi" }),
    ).rejects.toBeInstanceOf(SessionBusyError);
    // The failed turn never got going, so its optimistic mark is released.
    expect(registry.isBusy("agent:bot-2:main")).toBe(false);
  });

  it("allows the next message once the run completes (terminal chat event)", async () => {
    let sends = 0;
    const { service, registry } = makeService(async () => {
      sends += 1;
      return { runId: `run-${sends}`, messageId: `m${sends}`, content: null };
    });

    await service.sendLocalMessage("bot-3", { type: "text", content: "one" });
    registry.handleChatEvent({
      sessionKey: "agent:bot-3:main",
      state: "final",
    });

    await service.sendLocalMessage("bot-3", { type: "text", content: "two" });
    expect(sends).toBe(2);
  });
});
