import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ControllerEnv } from "../src/app/env.js";
import { SessionsRuntime } from "../src/runtime/sessions-runtime.js";

function createEnv(rootDir: string): ControllerEnv {
  return {
    nodeEnv: "test",
    port: 3010,
    host: "127.0.0.1",
    webUrl: "http://localhost:5173",
    nexuCloudUrl: "https://nexu.io",
    nexuLinkUrl: null,
    nexuHomeDir: path.join(rootDir, ".nexu"),
    nexuConfigPath: path.join(rootDir, ".nexu", "config.json"),
    artifactsIndexPath: path.join(rootDir, ".nexu", "artifacts.json"),
    compiledOpenclawSnapshotPath: path.join(rootDir, "compiled.json"),
    openclawStateDir: rootDir,
    openclawConfigPath: path.join(rootDir, "openclaw.json"),
    openclawSkillsDir: path.join(rootDir, "skills"),
    openclawCuratedSkillsDir: path.join(rootDir, "bundled-skills"),
    skillhubCacheDir: path.join(rootDir, "skillhub-cache"),
    skillDbPath: path.join(rootDir, "skillhub.db"),
    staticSkillsDir: undefined,
    openclawWorkspaceTemplatesDir: path.join(rootDir, "workspace-templates"),
    openclawBin: "openclaw",
    litellmBaseUrl: null,
    litellmApiKey: null,
    openclawGatewayPort: 18789,
    openclawGatewayToken: "token-123",
    manageOpenclawProcess: false,
    gatewayProbeEnabled: false,
    runtimeSyncIntervalMs: 2000,
    runtimeHealthIntervalMs: 5000,
    defaultModelId: "anthropic/claude-sonnet-4",
  } as ControllerEnv;
}

async function writeTranscript(
  sessionsDir: string,
  sessionId: string,
  stopReason?: string,
) {
  const transcriptPath = path.join(sessionsDir, `${sessionId}.jsonl`);
  await writeFile(
    transcriptPath,
    [
      JSON.stringify({
        type: "message",
        id: `${sessionId}-user`,
        timestamp: "2026-08-03T01:00:00.000Z",
        message: {
          role: "user",
          timestamp: Date.parse("2026-08-03T01:00:00.000Z"),
          content: [{ type: "text", text: `${sessionId} request` }],
        },
      }),
      JSON.stringify({
        type: "message",
        id: `${sessionId}-assistant`,
        timestamp: "2026-08-03T01:01:00.000Z",
        message: {
          role: "assistant",
          timestamp: Date.parse("2026-08-03T01:01:00.000Z"),
          content: [{ type: "text", text: `${sessionId} reply` }],
          ...(stopReason ? { stopReason } : {}),
        },
      }),
    ].join("\n"),
    "utf8",
  );
  return transcriptPath;
}

describe("SessionsRuntime organization metadata", () => {
  let rootDir: string | null = null;

  afterEach(async () => {
    if (rootDir) {
      await rm(rootDir, { recursive: true, force: true });
      rootDir = null;
    }
  });

  it("preserves default archive filtering and exposes OpenClaw organization state", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "nexu-session-org-"));
    const sessionsDir = path.join(rootDir, "agents", "bot-1", "sessions");
    await mkdir(sessionsDir, { recursive: true });
    const activePath = await writeTranscript(
      sessionsDir,
      "active-session",
      "error",
    );
    const archivedPath = await writeTranscript(sessionsDir, "archived-session");
    await writeFile(
      path.join(sessionsDir, "sessions.json"),
      JSON.stringify({
        "agent:bot-1:active": {
          sessionId: "active-session",
          sessionFile: activePath,
          category: "Launch",
          pinnedAt: 1_754_186_400_000,
          lastReadAt: 100,
          lastActivityAt: 200,
          status: "done",
          totalTokens: 32_000,
          totalTokensFresh: true,
          contextTokens: 128_000,
          modelProvider: "openai",
          model: "gpt-5.6",
          compactionCheckpoints: [{ checkpointId: "checkpoint-1" }],
        },
        "agent:bot-1:archived": {
          sessionId: "archived-session",
          sessionFile: archivedPath,
          archivedAt: 1_754_186_400_000,
        },
      }),
      "utf8",
    );
    const runtime = new SessionsRuntime(createEnv(rootDir));

    const defaultSessions = await runtime.listSessions();
    const allSessions = await runtime.listSessions(false, "include");
    const archivedSessions = await runtime.listSessions(false, "only");

    expect(defaultSessions.map((item) => item.id)).toEqual([
      "active-session.jsonl",
    ]);
    expect(allSessions).toHaveLength(2);
    expect(archivedSessions.map((item) => item.id)).toEqual([
      "archived-session.jsonl",
    ]);
    expect(defaultSessions[0]).toMatchObject({
      category: "Launch",
      pinned: true,
      unread: true,
      archived: false,
      checkpointCount: 1,
      runState: "failed",
      totalTokens: 32_000,
      totalTokensFresh: true,
      contextTokens: 128_000,
      modelProvider: "openai",
      model: "gpt-5.6",
    });
    expect(archivedSessions[0]).toMatchObject({
      archived: true,
      archivedAt: "2025-08-03T02:00:00.000Z",
    });
  });
});
