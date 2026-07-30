import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AttachmentStore } from "../src/services/attachment-store.js";
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
  it("routes stored Office attachments to the bundled OfficeCLI skill", async () => {
    const sendToMainSession = vi.fn(async () => ({
      runId: "run-office",
      messageId: "message-office",
      content: null,
    }));
    const attachmentStore = {
      saveAttachment: vi.fn(async () => ({
        absolutePath: "/tmp/openclaw/workspace/bot/report.docx",
        storedFilename: "report.docx",
        sizeBytes: 9,
      })),
    } satisfies Pick<AttachmentStore, "saveAttachment">;
    const service = new ChatService(
      { sendToMainSession } as unknown as OpenClawGatewayService,
      attachmentStore as unknown as AttachmentStore,
      new SessionRunRegistry(),
    );

    await service.sendLocalMessage("bot-office", {
      type: "text",
      content: "更新这份报告",
      attachments: [
        {
          type: "file",
          content: Buffer.from("fake-docx").toString("base64"),
          metadata: {
            filename: "reports/report.docx",
            mimeType:
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            size: 9,
          },
        },
      ],
    });

    const message = sentMessage(sendToMainSession);
    expect(message).toContain('path="/tmp/openclaw/workspace/bot/report.docx"');
    expect(message).toContain("Use the `officecli` skill");
    expect(message).not.toContain("Use the `pdf` tool");
  });

  it("imports a staged Office file without requiring inline base64", async () => {
    const sendToMainSession = vi.fn(async () => ({
      runId: "run-staged-office",
      messageId: "message-staged-office",
      content: null,
    }));
    const attachmentStore = {
      importStagedAttachment: vi.fn(async () => ({
        absolutePath: "/tmp/openclaw/workspace/bot/report.xlsx",
        storedFilename: "report.xlsx",
        sizeBytes: 48_000_000,
        stagedPath: "/tmp/openclaw/media/inbound/batch/report.xlsx",
      })),
    } satisfies Pick<AttachmentStore, "importStagedAttachment">;
    const service = new ChatService(
      { sendToMainSession } as unknown as OpenClawGatewayService,
      attachmentStore as unknown as AttachmentStore,
      new SessionRunRegistry(),
    );

    await service.sendLocalMessage("bot-office", {
      type: "text",
      content: "分析这个工作簿",
      attachments: [
        {
          type: "file",
          stagedPath: "/tmp/openclaw/media/inbound/batch/report.xlsx",
          metadata: {
            filename: "report.xlsx",
            mimeType:
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            size: 48_000_000,
          },
        },
      ],
    });

    expect(attachmentStore.importStagedAttachment).toHaveBeenCalledOnce();
    const message = sentMessage(sendToMainSession);
    expect(message).toContain('path="/tmp/openclaw/workspace/bot/report.xlsx"');
    expect(message).toContain("Use the `officecli` skill");
  });

  it("passes a staged directory to the agent as one directory reference", async () => {
    const sendToMainSession = vi.fn(async () => ({
      runId: "run-directory",
      messageId: "message-directory",
      content: null,
    }));
    const attachmentStore = {
      importStagedAttachment: vi.fn(async () => ({
        absolutePath: "/tmp/openclaw/workspace/bot/project",
        storedFilename: "project",
        sizeBytes: 12_000,
        stagedPath: "/tmp/openclaw/media/inbound/batch/project",
      })),
    } satisfies Pick<AttachmentStore, "importStagedAttachment">;
    const service = new ChatService(
      { sendToMainSession } as unknown as OpenClawGatewayService,
      attachmentStore as unknown as AttachmentStore,
      new SessionRunRegistry(),
    );

    await service.sendLocalMessage("bot-directory", {
      type: "text",
      content: "检查这个项目",
      attachments: [
        {
          type: "directory",
          stagedPath: "/tmp/openclaw/media/inbound/batch/project",
          metadata: {
            filename: "project",
            mimeType: "application/x-directory",
            size: 12_000,
          },
        },
      ],
    });

    const message = sentMessage(sendToMainSession);
    expect(message).toContain("<directory");
    expect(message).toContain('path="/tmp/openclaw/workspace/bot/project"');
    expect(message).toContain("preserve the directory structure");
  });

  it("converts a staged image to gateway base64 only after controller import", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "nexu-chat-image-"));
    const importedPath = path.join(tempDir, "image.png");
    await writeFile(importedPath, "fake-png");
    const sendToMainSession = vi.fn(async () => ({
      runId: "run-image",
      messageId: "message-image",
      content: null,
    }));
    const attachmentStore = {
      importStagedAttachment: vi.fn(async () => ({
        absolutePath: importedPath,
        storedFilename: "image.png",
        sizeBytes: 8,
        stagedPath: "/tmp/openclaw/media/inbound/batch/image.png",
      })),
    } satisfies Pick<AttachmentStore, "importStagedAttachment">;
    const service = new ChatService(
      { sendToMainSession } as unknown as OpenClawGatewayService,
      attachmentStore as unknown as AttachmentStore,
      new SessionRunRegistry(),
    );

    await service.sendLocalMessage("bot-image", {
      type: "text",
      content: "看看这张图",
      attachments: [
        {
          type: "image",
          stagedPath: "/tmp/openclaw/media/inbound/batch/image.png",
          metadata: {
            filename: "image.png",
            mimeType: "image/png",
            size: 8,
          },
        },
      ],
    });

    expect(attachmentStore.importStagedAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ maxBytes: 25_000_000 }),
    );
    const call = sendToMainSession.mock.calls[0]?.[0] as
      | { attachments?: Array<{ data: string }> }
      | undefined;
    expect(call?.attachments?.[0]?.data).toBe(
      Buffer.from("fake-png").toString("base64"),
    );
  });

  it("restores earlier staged files in reverse order when a later import fails", async () => {
    const stateDir = await mkdtemp(path.join(os.tmpdir(), "nexu-chat-files-"));
    const batchDir = path.join(stateDir, "media", "inbound", "batch-partial");
    const firstPath = path.join(batchDir, "001-first.txt");
    const secondPath = path.join(batchDir, "002-second.txt");
    const missingPath = path.join(batchDir, "003-missing.txt");
    await mkdir(batchDir, { recursive: true });
    await writeFile(firstPath, "first");
    await writeFile(secondPath, "second");
    const attachmentStore = new AttachmentStore({
      openclawStateDir: stateDir,
    });
    const restoreSpy = vi.spyOn(attachmentStore, "restoreStagedAttachment");
    const sendToMainSession = vi.fn(async () => ({
      runId: "run-unexpected",
      messageId: "message-unexpected",
      content: null,
    }));
    const service = new ChatService(
      { sendToMainSession } as unknown as OpenClawGatewayService,
      attachmentStore,
      new SessionRunRegistry(),
    );

    await expect(
      service.sendLocalMessage("bot-files", {
        type: "text",
        content: "read these files",
        attachments: [firstPath, secondPath, missingPath].map((stagedPath) => ({
          type: "file" as const,
          stagedPath,
          metadata: {
            filename: path.basename(stagedPath),
            mimeType: "text/plain",
          },
        })),
      }),
    ).rejects.toThrow();

    expect(sendToMainSession).not.toHaveBeenCalled();
    expect(restoreSpy.mock.calls.map(([item]) => item.stagedPath)).toEqual([
      secondPath,
      firstPath,
    ]);
    expect(await readFile(firstPath, "utf8")).toBe("first");
    expect(await readFile(secondPath, "utf8")).toBe("second");
  });

  it("restores a staged file after gateway failure so the same request can retry", async () => {
    const stateDir = await mkdtemp(path.join(os.tmpdir(), "nexu-chat-files-"));
    const stagedPath = path.join(
      stateDir,
      "media",
      "inbound",
      "batch-retry",
      "001-notes.txt",
    );
    await mkdir(path.dirname(stagedPath), { recursive: true });
    await writeFile(stagedPath, "retry me");
    const sendToMainSession = vi
      .fn()
      .mockRejectedValueOnce(new Error("gateway unavailable"))
      .mockResolvedValueOnce({
        runId: "run-retry",
        messageId: "message-retry",
        content: null,
      });
    const service = new ChatService(
      { sendToMainSession } as unknown as OpenClawGatewayService,
      new AttachmentStore({ openclawStateDir: stateDir }),
      new SessionRunRegistry(),
    );
    const request = {
      type: "text" as const,
      content: "read this file",
      attachments: [
        {
          type: "file" as const,
          stagedPath,
          metadata: {
            filename: "notes.txt",
            mimeType: "text/plain",
          },
        },
      ],
    };

    await expect(
      service.sendLocalMessage("bot-retry", request),
    ).rejects.toThrow("gateway unavailable");
    expect(await readFile(stagedPath, "utf8")).toBe("retry me");

    await expect(
      service.sendLocalMessage("bot-retry", request),
    ).resolves.toMatchObject({ id: "message-retry", runId: "run-retry" });
    await expect(stat(stagedPath)).rejects.toThrow();
    expect(sendToMainSession).toHaveBeenCalledTimes(2);
  });

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
