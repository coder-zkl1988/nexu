import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ApprovalAuditService } from "../src/services/approval-audit-service.js";

const tempDirs: string[] = [];

async function createService() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "nexu-approval-audit-"));
  tempDirs.push(dir);
  const filePath = path.join(dir, "approval-audit-ledger.json");
  return { filePath, service: new ApprovalAuditService(filePath) };
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("ApprovalAuditService", () => {
  it("persists sanitized gateway approval lifecycle metadata", async () => {
    const { filePath, service } = await createService();
    const now = Date.now();
    await service.observeGatewayRequested("exec", {
      id: "approval-1",
      request: {
        commandPreview: "curl -H 'Authorization: Bearer command-secret'",
        description: "deploy with description-secret",
        env: { SECRET_TOKEN: "must-not-leak" },
        agentId: "agent-1",
        sessionKey: "agent:agent-1:main",
      },
      createdAtMs: now - 10,
      expiresAtMs: now + 10_000,
    });
    await service.recordResolved({
      approvalId: "approval-1",
      source: "openclaw",
      kind: "exec",
      status: "approved",
      decision: "allow-once",
      reviewer: "Desktop User",
      resolvedAt: now - 5,
    });

    const restarted = new ApprovalAuditService(filePath);
    await expect(restarted.list()).resolves.toEqual([
      expect.objectContaining({
        approvalId: "approval-1",
        status: "approved",
        decision: "allow-once",
        reviewer: "Desktop User",
        title: "Command approval",
      }),
      expect.objectContaining({
        approvalId: "approval-1",
        status: "pending",
        title: "Command approval",
      }),
    ]);
    const raw = await readFile(filePath, "utf8");
    expect(raw).not.toContain("command-secret");
    expect(raw).not.toContain("description-secret");
    expect(raw).not.toContain("curl");
    expect(raw).not.toContain("SECRET_TOKEN");
    expect(raw).not.toContain("must-not-leak");
  });

  it("marks pending team approvals interrupted after controller restart", async () => {
    const { filePath, service } = await createService();
    await service.recordRequested({
      approvalId: "run-1:step-1",
      source: "team",
      kind: "team",
      title: "Publish task-secret",
      description: "Approve task-prompt-secret with password=credential-secret",
      teamId: "team-1",
      runId: "run-1",
      stepId: "step-1",
      requestedAt: Date.now(),
    });

    const restarted = new ApprovalAuditService(filePath);
    await restarted.markInterruptedTeamApprovals();
    await expect(restarted.list()).resolves.toEqual([
      expect.objectContaining({
        status: "interrupted",
        decision: "interrupted",
        reviewer: "system",
      }),
      expect.objectContaining({ status: "pending" }),
    ]);
    const raw = await readFile(filePath, "utf8");
    expect(raw).not.toContain("task-secret");
    expect(raw).not.toContain("task-prompt-secret");
    expect(raw).not.toContain("credential-secret");
  });

  it("ignores the generic gateway identity so a real reviewer is retained", async () => {
    const { service } = await createService();
    const now = Date.now();
    await service.observeGatewayRequested("plugin", {
      id: "plugin:approval-1",
      request: { title: "Control browser" },
      createdAtMs: now - 10,
      expiresAtMs: now + 10_000,
    });
    await service.observeGatewayResolved("plugin", {
      id: "plugin:approval-1",
      decision: "allow-once",
      resolvedBy: "gateway-client",
      ts: now - 5,
      request: { title: "Control browser" },
    });
    await service.recordResolved({
      approvalId: "plugin:approval-1",
      source: "openclaw",
      kind: "plugin",
      status: "approved",
      decision: "allow-once",
      reviewer: "Alice",
      resolvedAt: now,
    });

    const entries = await service.list();
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "pending" }),
        expect.objectContaining({ status: "approved", reviewer: "Alice" }),
      ]),
    );
  });

  it("persists an expired decision when no resolved event arrives", async () => {
    const { service } = await createService();
    const now = Date.now();
    await service.recordRequested({
      approvalId: "approval-expired",
      source: "openclaw",
      kind: "exec",
      title: "Expired command",
      requestedAt: now - 10,
      expiresAt: now - 1,
    });

    await expect(service.list()).resolves.toEqual([
      expect.objectContaining({
        status: "expired",
        decision: "expired",
        reviewer: "system",
        resolvedAt: now - 1,
      }),
      expect.objectContaining({ status: "pending" }),
    ]);
  });

  it("deduplicates repeated lifecycle observations without replacing events", async () => {
    const { service } = await createService();
    const now = Date.now();
    const requested = {
      approvalId: "approval-dedupe",
      source: "openclaw" as const,
      kind: "plugin" as const,
      title: "sensitive plugin title",
      description: "sensitive plugin description",
      requestedAt: now - 10,
      expiresAt: now + 10_000,
    };
    const resolved = {
      approvalId: "approval-dedupe",
      source: "openclaw" as const,
      kind: "plugin" as const,
      status: "approved" as const,
      decision: "allow-once" as const,
      reviewer: "Alice",
      resolvedAt: now,
    };

    await service.recordRequested(requested);
    await service.recordRequested(requested);
    await service.recordResolved(resolved);
    await service.recordResolved(resolved);

    const entries = await service.list();
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.status)).toEqual([
      "approved",
      "pending",
    ]);
    expect(entries.every((entry) => entry.title === "Plugin approval")).toBe(
      true,
    );
  });

  it("retains two approval requests recorded concurrently", async () => {
    const { service } = await createService();
    const now = Date.now();

    await Promise.all([
      service.recordRequested({
        approvalId: "approval-concurrent-a",
        source: "openclaw",
        kind: "exec",
        title: "Command A",
        requestedAt: now,
      }),
      service.recordRequested({
        approvalId: "approval-concurrent-b",
        source: "openclaw",
        kind: "plugin",
        title: "Plugin B",
        requestedAt: now + 1,
      }),
    ]);

    const entries = await service.list();
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.approvalId).sort()).toEqual([
      "approval-concurrent-a",
      "approval-concurrent-b",
    ]);
  });

  it("retains request and resolution events recorded concurrently", async () => {
    const { service } = await createService();
    const now = Date.now();

    await Promise.all([
      service.recordRequested({
        approvalId: "approval-concurrent-lifecycle",
        source: "openclaw",
        kind: "exec",
        title: "Sensitive command",
        requestedAt: now,
      }),
      service.recordResolved({
        approvalId: "approval-concurrent-lifecycle",
        source: "openclaw",
        kind: "exec",
        status: "approved",
        decision: "allow-once",
        reviewer: "Alice",
        resolvedAt: now + 1,
      }),
    ]);

    const entries = await service.list();
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.status).sort()).toEqual([
      "approved",
      "pending",
    ]);
  });

  it("continues processing queued operations after one update fails", async () => {
    const { service } = await createService();

    await expect(
      service.recordRequested({
        approvalId: "approval-invalid",
        source: "openclaw",
        kind: "exec",
        title: "Invalid timestamp",
        requestedAt: -1,
      }),
    ).rejects.toThrow();

    await expect(
      service.recordRequested({
        approvalId: "approval-after-failure",
        source: "openclaw",
        kind: "exec",
        title: "Valid request",
        requestedAt: Date.now(),
      }),
    ).resolves.toMatchObject({ approvalId: "approval-after-failure" });
    await expect(service.list()).resolves.toEqual([
      expect.objectContaining({ approvalId: "approval-after-failure" }),
    ]);
  });
});
