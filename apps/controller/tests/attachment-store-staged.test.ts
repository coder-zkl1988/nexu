import {
  mkdir,
  mkdtemp,
  readFile,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AttachmentStore } from "../src/services/attachment-store.js";

describe("AttachmentStore staged imports", () => {
  it("moves an app-staged file into the session attachment workspace", async () => {
    const stateDir = await mkdtemp(
      path.join(os.tmpdir(), "nexu-attachment-store-"),
    );
    const stagedPath = path.join(
      stateDir,
      "media",
      "inbound",
      "batch-1",
      "001-report.xlsx",
    );
    await mkdir(path.dirname(stagedPath), { recursive: true });
    await writeFile(stagedPath, "spreadsheet");
    const store = new AttachmentStore({ openclawStateDir: stateDir });

    const imported = await store.importStagedAttachment({
      botId: "bot-1",
      sessionKey: "agent:bot-1:main",
      stagedPath,
      filename: "report.xlsx",
      kind: "file",
    });

    expect(imported.absolutePath).toContain(
      path.join("workspace", "bot-1", "attachments", "agent_bot-1_main"),
    );
    expect(imported.stagedPath).toBe(stagedPath);
    expect(imported.sizeBytes).toBe(11);
    expect(await readFile(imported.absolutePath, "utf8")).toBe("spreadsheet");
    await expect(readFile(stagedPath)).rejects.toThrow();
    await expect(stat(path.dirname(stagedPath))).rejects.toThrow();
  });

  it("restores an imported file to its original staged path", async () => {
    const stateDir = await mkdtemp(
      path.join(os.tmpdir(), "nexu-attachment-store-"),
    );
    const stagedPath = path.join(
      stateDir,
      "media",
      "inbound",
      "batch-restore",
      "001-report.docx",
    );
    await mkdir(path.dirname(stagedPath), { recursive: true });
    await writeFile(stagedPath, "document");
    const store = new AttachmentStore({ openclawStateDir: stateDir });

    const imported = await store.importStagedAttachment({
      botId: "bot-1",
      sessionKey: "agent:bot-1:main",
      stagedPath,
      filename: "report.docx",
      kind: "file",
    });
    await store.restoreStagedAttachment(imported);

    expect(await readFile(stagedPath, "utf8")).toBe("document");
    await expect(stat(imported.absolutePath)).rejects.toThrow();
  });

  it("checks the remaining message budget before moving a staged file", async () => {
    const stateDir = await mkdtemp(
      path.join(os.tmpdir(), "nexu-attachment-store-"),
    );
    const stagedPath = path.join(
      stateDir,
      "media",
      "inbound",
      "batch-budget",
      "001-report.xlsx",
    );
    await mkdir(path.dirname(stagedPath), { recursive: true });
    await writeFile(stagedPath, "spreadsheet");
    const store = new AttachmentStore({ openclawStateDir: stateDir });

    await expect(
      store.importStagedAttachment({
        botId: "bot-1",
        sessionKey: "agent:bot-1:main",
        stagedPath,
        filename: "report.xlsx",
        kind: "file",
        maxBytes: 10,
      }),
    ).rejects.toThrow("remaining message byte budget");

    expect(await readFile(stagedPath, "utf8")).toBe("spreadsheet");
  });

  it("rejects paths outside the app-owned inbound directory", async () => {
    const stateDir = await mkdtemp(
      path.join(os.tmpdir(), "nexu-attachment-store-"),
    );
    const outside = path.join(stateDir, "outside.docx");
    await writeFile(outside, "private");
    const store = new AttachmentStore({ openclawStateDir: stateDir });

    await expect(
      store.importStagedAttachment({
        botId: "bot-1",
        sessionKey: "agent:bot-1:main",
        stagedPath: outside,
        filename: "outside.docx",
        kind: "file",
      }),
    ).rejects.toThrow("outside inbound root");
  });

  it("rejects an inbound symlink that resolves outside the staging root", async () => {
    const stateDir = await mkdtemp(
      path.join(os.tmpdir(), "nexu-attachment-store-"),
    );
    const outside = path.join(stateDir, "outside.docx");
    const stagedPath = path.join(
      stateDir,
      "media",
      "inbound",
      "batch-link",
      "001-outside.docx",
    );
    await writeFile(outside, "private");
    await mkdir(path.dirname(stagedPath), { recursive: true });
    await symlink(outside, stagedPath);
    const store = new AttachmentStore({ openclawStateDir: stateDir });

    await expect(
      store.importStagedAttachment({
        botId: "bot-1",
        sessionKey: "agent:bot-1:main",
        stagedPath,
        filename: "outside.docx",
        kind: "file",
      }),
    ).rejects.toThrow("resolves outside inbound root");
  });

  it("rejects an inbound symlink even when its target stays inside the staging root", async () => {
    const stateDir = await mkdtemp(
      path.join(os.tmpdir(), "nexu-attachment-store-"),
    );
    const batchDir = path.join(stateDir, "media", "inbound", "batch-link");
    const targetPath = path.join(batchDir, "target.docx");
    const stagedPath = path.join(batchDir, "001-target.docx");
    await mkdir(batchDir, { recursive: true });
    await writeFile(targetPath, "private");
    await symlink(targetPath, stagedPath);
    const store = new AttachmentStore({ openclawStateDir: stateDir });

    await expect(
      store.importStagedAttachment({
        botId: "bot-1",
        sessionKey: "agent:bot-1:main",
        stagedPath,
        filename: "target.docx",
        kind: "file",
      }),
    ).rejects.toThrow("symbolic links are not supported");
    expect(await readFile(targetPath, "utf8")).toBe("private");
  });

  it("expires imported directory attachments recursively", async () => {
    const stateDir = await mkdtemp(
      path.join(os.tmpdir(), "nexu-attachment-store-"),
    );
    const directoryPath = path.join(
      stateDir,
      "workspace",
      "bot-1",
      "attachments",
      "agent_bot-1_main",
      "project",
    );
    await mkdir(directoryPath, { recursive: true });
    await writeFile(path.join(directoryPath, "notes.txt"), "old");
    const oldTime = new Date(Date.now() - 60_000);
    await utimes(directoryPath, oldTime, oldTime);
    const store = new AttachmentStore({
      openclawStateDir: stateDir,
      ttlMs: 1000,
    });

    await expect(store.cleanupExpired()).resolves.toEqual({
      deleted: 1,
      skipped: 0,
    });
    await expect(stat(directoryPath)).rejects.toThrow();
  });
});
