import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExpertLedger } from "../src/services/experthub/types.js";
import { TeamLedgerStore } from "../src/services/teams/team-ledger.js";
import {
  TeamAssigneeNotMemberError,
  TeamMemberNotInstalledError,
  TeamService,
  type TeamServiceDeps,
} from "../src/services/teams/team-service.js";

function makeExpertLedger(): ExpertLedger {
  return {
    version: 1,
    updatedAt: null,
    entries: {
      reviewer: {
        slug: "reviewer",
        version: "1.0.0",
        botId: "bot-reviewer",
        installedAt: "2026-01-01T00:00:00.000Z",
        name: "Code Reviewer",
      },
      writer: {
        slug: "writer",
        version: "1.0.0",
        botId: "bot-writer",
        installedAt: "2026-01-01T00:00:00.000Z",
        name: "Tech Writer",
      },
    },
  };
}

describe("TeamService", () => {
  let tmpDir: string;
  let ledger: TeamLedgerStore;
  let gateway: {
    workboardBoardUpsert: ReturnType<typeof vi.fn>;
    workboardCardCreate: ReturnType<typeof vi.fn>;
    workboardCardDecompose: ReturnType<typeof vi.fn>;
    workboardCardMove: ReturnType<typeof vi.fn>;
    workboardCardsList: ReturnType<typeof vi.fn>;
    workboardCardComment: ReturnType<typeof vi.fn>;
    workboardCardComplete: ReturnType<typeof vi.fn>;
    workboardCardBlock: ReturnType<typeof vi.fn>;
    workboardCardDelete: ReturnType<typeof vi.fn>;
    workboardBoardDelete: ReturnType<typeof vi.fn>;
  };
  let syncAll: ReturnType<typeof vi.fn>;
  let createBot: ReturnType<typeof vi.fn>;
  let updateBotSystemPrompt: ReturnType<typeof vi.fn>;
  let applyLeadPersona: ReturnType<typeof vi.fn>;
  let installExpert: ReturnType<typeof vi.fn>;
  let sendChat: ReturnType<typeof vi.fn>;
  let readSessionEntry: ReturnType<typeof vi.fn>;
  let readAssistantReply: ReturnType<typeof vi.fn>;
  let mockExpertLedger: ExpertLedger;

  function buildService(overrides: Partial<TeamServiceDeps> = {}): TeamService {
    return new TeamService(
      {
        ledger,
        gateway,
        resolveExpertPersona: async (slug) =>
          slug === "reviewer" ? "You are the Code Sentinel." : "I write docs.",
        resolveExpertName: async (slug) =>
          mockExpertLedger.entries[slug]?.name ?? null,
        readExpertLedger: async () => mockExpertLedger,
        installExpert,
        botService: {
          createBot,
          updateBotSystemPrompt,
          deleteBot: vi.fn(async () => true),
        },
        applyLeadPersona,
        syncAll,
        getGlobalModelId: async () => "link/default",
        genId: () => "team-id-1",
        genBotSlug: (base) => `${base}-slug`,
        resolveExpertDescription: async (slug) => `desc of ${slug}`,
        removeTeamWorkflows: vi.fn(async () => 0),
        sendChat,
        readSessionEntry,
        readAssistantReply,
        ...overrides,
      },
      { pollIntervalMs: 1, stepTimeoutMs: 500, emptyDoneTimeoutMs: 50 },
    );
  }

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "team-svc-"));
    ledger = new TeamLedgerStore(join(tmpDir, "team-ledger.json"));
    mockExpertLedger = makeExpertLedger();
    // Default: installing an expert adds it to the (mutable) experthub ledger.
    installExpert = vi.fn(async (slug: string) => {
      mockExpertLedger.entries[slug] = {
        slug,
        version: "1.0.0",
        botId: `bot-${slug}`,
        installedAt: "2026-01-01T00:00:00.000Z",
        name: `Installed ${slug}`,
      };
    });
    gateway = {
      workboardBoardUpsert: vi.fn(async () => ({})),
      workboardCardCreate: vi.fn(async () => ({
        card: { id: "parent-1", title: "task", status: "todo" },
      })),
      workboardCardDecompose: vi.fn(
        async (params: {
          children: Array<{ title: string; agentId?: string; notes?: string }>;
        }) => ({
          children: params.children.map((child, index) => ({
            id: `child-${index}`,
            title: child.title,
            status: "todo",
            agentId: child.agentId,
            notes: child.notes,
          })),
        }),
      ),
      workboardCardMove: vi.fn(async () => ({
        card: { id: "x", title: "t", status: "ready" },
      })),
      workboardCardsList: vi.fn(async () => ({ cards: [] })),
      workboardCardComment: vi.fn(async () => ({})),
      workboardCardComplete: vi.fn(async () => ({})),
      workboardCardBlock: vi.fn(async () => ({})),
      workboardCardDelete: vi.fn(async () => ({})),
      workboardBoardDelete: vi.fn(async () => ({})),
    };
    syncAll = vi.fn(async () => undefined);
    createBot = vi.fn(async () => ({ id: "bot-lead" }));
    updateBotSystemPrompt = vi.fn(async () => undefined);
    applyLeadPersona = vi.fn(async () => undefined);
    sendChat = vi.fn(async () => ({ status: "started" }));
    // Every lane is "done" on the first poll by default (fast, deterministic tests).
    readSessionEntry = vi.fn(async () => ({
      status: "done",
      sessionFile: "/fake/session.jsonl",
    }));
    readAssistantReply = vi.fn(async () => "the deliverable");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("createTeam resolves installed members, creates a lead bot, and persists", async () => {
    const service = buildService();
    const team = await service.createTeam({
      name: "Docs Squad",
      memberSlugs: ["reviewer", "writer"],
    });

    expect(team.leadBotId).toBe("bot-lead");
    expect(team.members).toEqual([
      { expertSlug: "reviewer", botId: "bot-reviewer", name: "Code Reviewer" },
      { expertSlug: "writer", botId: "bot-writer", name: "Tech Writer" },
    ]);
    expect(team.boardId).toBe("team-team-id-1");
    expect(ledger.get(team.id)).not.toBeNull();
    expect(createBot).toHaveBeenCalledTimes(1);
    expect(syncAll).toHaveBeenCalledTimes(1);

    // The lead must be told its role + roster, or it defaults to a generic
    // assistant persona with no awareness it's a team coordinator.
    const leadPrompt = createBot.mock.calls[0][0].systemPrompt as string;
    expect(leadPrompt).toContain("Docs Squad");
    expect(leadPrompt).toContain("Code Reviewer：desc of reviewer");
    expect(leadPrompt).toContain("Tech Writer：desc of writer");
    // The lead's persona must steer collaborative tasks to the structured
    // team engine, keeping sessions_spawn for lightweight consults only.
    expect(leadPrompt).toContain("team_run_auto");
    expect(leadPrompt).toContain("team_run_workflow");
    expect(leadPrompt).toContain("sessions_spawn");
    // Must override AGENTS.md's generic "list installed skills" first-contact
    // step, or the lead recites the platform-wide tool list instead of its team.
    expect(leadPrompt).toContain("不要");
    expect(leadPrompt).toContain("首次接触");

    // bot.systemPrompt alone never reaches a live conversation (the compiler
    // never reads it) — the persona must also be folded into AGENTS.md.
    expect(applyLeadPersona).toHaveBeenCalledWith("bot-lead", leadPrompt);
  });

  it("createTeam auto-installs an uninstalled member", async () => {
    const service = buildService();
    const team = await service.createTeam({
      name: "Docs Squad",
      memberSlugs: ["reviewer", "ghost"],
    });

    expect(installExpert).toHaveBeenCalledTimes(1);
    expect(installExpert).toHaveBeenCalledWith("ghost");
    expect(team.members).toContainEqual({
      expertSlug: "ghost",
      botId: "bot-ghost",
      name: "Installed ghost",
    });
  });

  it("createTeam rejects when an uninstalled member fails to install", async () => {
    installExpert.mockRejectedValueOnce(new Error("install failed"));
    const service = buildService();
    await expect(
      service.createTeam({ name: "X", memberSlugs: ["ghost"] }),
    ).rejects.toBeInstanceOf(TeamMemberNotInstalledError);
    expect(createBot).not.toHaveBeenCalled();
  });

  it("updateTeam renames and replaces members", async () => {
    const service = buildService();
    const team = await service.createTeam({
      name: "Docs Squad",
      memberSlugs: ["reviewer"],
    });
    syncAll.mockClear();

    const updated = await service.updateTeam(team.id, {
      name: "Renamed Squad",
      memberSlugs: ["writer"],
    });

    expect(updated.name).toBe("Renamed Squad");
    expect(updated.members).toEqual([
      { expertSlug: "writer", botId: "bot-writer", name: "Tech Writer" },
    ]);
    expect(updated.leadBotId).toBe(team.leadBotId);
    expect(ledger.get(team.id)?.name).toBe("Renamed Squad");
    expect(syncAll).toHaveBeenCalledTimes(1);

    // Renaming/re-rostering must refresh the lead's persona, not just the ledger
    // record, or the bot keeps introducing itself as the old team.
    expect(updateBotSystemPrompt).toHaveBeenCalledTimes(1);
    const [leadBotId, leadPrompt] = updateBotSystemPrompt.mock.calls[0] as [
      string,
      string,
    ];
    expect(leadBotId).toBe(team.leadBotId);
    expect(leadPrompt).toContain("Renamed Squad");
    expect(leadPrompt).toContain("Tech Writer：desc of writer");
    expect(leadPrompt).not.toContain("Code Reviewer");

    // AGENTS.md is what a live conversation actually reads — must refresh too.
    expect(applyLeadPersona).toHaveBeenCalledWith(team.leadBotId, leadPrompt);
  });

  it("updateTeam leaves the lead's persona untouched on a no-op patch", async () => {
    const service = buildService();
    const team = await service.createTeam({
      name: "Docs Squad",
      memberSlugs: ["reviewer"],
    });
    updateBotSystemPrompt.mockClear();
    applyLeadPersona.mockClear();

    await service.updateTeam(team.id, {});

    expect(updateBotSystemPrompt).not.toHaveBeenCalled();
    expect(applyLeadPersona).not.toHaveBeenCalled();
  });

  it("runTask decomposes into member cards with persona injected into notes, then dispatches over chat.send", async () => {
    const service = buildService();
    const team = await service.createTeam({
      name: "Docs Squad",
      memberSlugs: ["reviewer", "writer"],
    });

    const result = await service.runTask(team.id, {
      task: "Ship the release notes",
      subtasks: [
        { title: "Review the diff", assigneeSlug: "reviewer" },
        {
          title: "Draft the notes",
          assigneeSlug: "writer",
          notes: "keep it short",
        },
      ],
    });

    // Board + parent card created against the team board.
    expect(gateway.workboardBoardUpsert).toHaveBeenCalledWith({
      id: team.boardId,
      name: "Docs Squad",
    });
    expect(gateway.workboardCardCreate).toHaveBeenCalledWith({
      title: "Ship the release notes",
      boardId: team.boardId,
      agentId: "bot-lead",
      priority: "high",
    });

    // Each child card is assigned to the member bot and carries the member's
    // persona in notes (the dispatcher worker does not load member AGENTS.md).
    const decomposeArg = gateway.workboardCardDecompose.mock.calls[0][0];
    expect(decomposeArg.id).toBe("parent-1");
    expect(decomposeArg.children[0].agentId).toBe("bot-reviewer");
    expect(decomposeArg.children[0].notes).toContain("Code Sentinel");
    expect(decomposeArg.children[0].notes).toContain("[PERSONA");
    expect(decomposeArg.children[1].agentId).toBe("bot-writer");
    expect(decomposeArg.children[1].notes).toContain("keep it short");

    // The endpoint returns immediately, one entry per started lane — it does
    // NOT depend on a dispatcher batch (design doc §10.4: the controller, not
    // the worker's tool-call compliance, decides completion).
    expect(result.parentCardId).toBe("parent-1");
    expect(result.started).toEqual([
      {
        cardId: "child-0",
        sessionKey: "agent:bot-reviewer:subagent:task-child-0",
      },
      {
        cardId: "child-1",
        sessionKey: "agent:bot-writer:subagent:task-child-1",
      },
    ]);

    // Completion is driven in the background: chat.send fires per card, the
    // controller polls the lane to done, then comments + completes the card.
    await vi.waitFor(() => {
      expect(gateway.workboardCardComplete).toHaveBeenCalledTimes(2);
    });
    expect(sendChat).toHaveBeenCalledWith({
      botId: "bot-reviewer",
      sessionKey: "agent:bot-reviewer:subagent:task-child-0",
      message: expect.stringContaining("Code Sentinel"),
    });
    // The subtask title is the primary task text — omitting it left the
    // worker with nothing to do but ask "what's the task?" (caught live).
    const [reviewerCall, writerCall] = sendChat.mock.calls as Array<
      [{ message: string }]
    >;
    expect(reviewerCall[0].message).toContain("Review the diff");
    expect(writerCall[0].message).toContain("Draft the notes");
    expect(writerCall[0].message).toContain("keep it short");
    expect(gateway.workboardCardMove).toHaveBeenCalledWith({
      id: "child-0",
      status: "running",
    });
    expect(gateway.workboardCardComment).toHaveBeenCalledWith({
      id: "child-0",
      body: "the deliverable",
    });
  });

  it("runTask survives a turn that ends done-with-no-text when a follow-up turn delivers", async () => {
    // Live failure mode: the worker pours the deliverable into a UI tool and
    // ends the turn with no reply text; OpenClaw then replays the queued
    // message as a second turn which DOES produce text. The grace window must
    // keep polling across the empty `done` instead of blocking the card.
    let polls = 0;
    readSessionEntry.mockImplementation(async () => {
      polls += 1;
      return { status: "done", sessionFile: "/fake/session.jsonl" };
    });
    readAssistantReply.mockImplementation(async () =>
      polls >= 3 ? "second-turn deliverable" : null,
    );
    const service = buildService();
    const team = await service.createTeam({
      name: "Docs Squad",
      memberSlugs: ["reviewer"],
    });

    await service.runTask(team.id, {
      task: "ship",
      subtasks: [{ title: "a", assigneeSlug: "reviewer" }],
    });

    await vi.waitFor(() => {
      expect(gateway.workboardCardComplete).toHaveBeenCalledWith({
        id: "child-0",
        summary: "done",
      });
    });
    expect(gateway.workboardCardComment).toHaveBeenCalledWith({
      id: "child-0",
      body: "second-turn deliverable",
    });
    expect(gateway.workboardCardBlock).not.toHaveBeenCalled();
  });

  it("runTask blocks a card that stays done-with-no-text past the grace window", async () => {
    readSessionEntry.mockResolvedValue({
      status: "done",
      sessionFile: "/fake/session.jsonl",
    });
    readAssistantReply.mockResolvedValue(null);
    const service = buildService();
    const team = await service.createTeam({
      name: "Docs Squad",
      memberSlugs: ["reviewer"],
    });

    await service.runTask(team.id, {
      task: "ship",
      subtasks: [{ title: "a", assigneeSlug: "reviewer" }],
    });

    await vi.waitFor(() => {
      expect(gateway.workboardCardBlock).toHaveBeenCalledWith({
        id: "child-0",
        reason: expect.stringContaining("finished without a reply"),
      });
    });
    expect(gateway.workboardCardComplete).not.toHaveBeenCalled();
  });

  it("runTask blocks a card whose lane never completes", async () => {
    readSessionEntry.mockImplementation(async (_botId: string, key: string) =>
      key.includes("child-0")
        ? { status: "running" }
        : { status: "done", sessionFile: "/fake/session.jsonl" },
    );
    const service = buildService();
    const team = await service.createTeam({
      name: "Docs Squad",
      memberSlugs: ["reviewer"],
    });

    await service.runTask(team.id, {
      task: "ship",
      subtasks: [{ title: "a", assigneeSlug: "reviewer" }],
    });

    await vi.waitFor(() => {
      expect(gateway.workboardCardBlock).toHaveBeenCalledWith({
        id: "child-0",
        reason: expect.stringContaining("timed out"),
      });
    });
    expect(gateway.workboardCardComplete).not.toHaveBeenCalled();
  });

  it("runTask rejects a subtask assigned to a non-member", async () => {
    const service = buildService();
    const team = await service.createTeam({
      name: "Docs Squad",
      memberSlugs: ["reviewer"],
    });

    await expect(
      service.runTask(team.id, {
        task: "do it",
        subtasks: [{ title: "x", assigneeSlug: "writer" }],
      }),
    ).rejects.toBeInstanceOf(TeamAssigneeNotMemberError);
    expect(gateway.workboardCardCreate).not.toHaveBeenCalled();
  });

  it("getBoard maps cards and resolves assignee names by bot id", async () => {
    gateway.workboardCardsList.mockResolvedValueOnce({
      cards: [
        { id: "p", title: "Audit", status: "todo", agentId: "bot-lead" },
        {
          id: "c1",
          title: "Review",
          status: "running",
          agentId: "bot-reviewer",
          metadata: {
            // The deliverable is the longest comment; short summaries lose.
            comments: [{ body: "LONG DELIVERABLE OUTPUT" }, { body: "done" }],
          },
        },
        { id: "c2", title: "Orphan", status: "ready", agentId: "bot-unknown" },
      ],
    });
    const service = buildService();
    const team = await service.createTeam({
      name: "Docs Squad",
      memberSlugs: ["reviewer", "writer"],
    });

    const board = await service.getBoard(team.id);

    expect(gateway.workboardCardsList).toHaveBeenCalledWith({
      boardId: team.boardId,
    });
    expect(board.boardId).toBe(team.boardId);
    expect(board.cards).toEqual([
      {
        id: "p",
        title: "Audit",
        status: "todo",
        agentId: "bot-lead",
        assigneeName: null,
        output: null,
      },
      {
        id: "c1",
        title: "Review",
        status: "running",
        agentId: "bot-reviewer",
        assigneeName: "Code Reviewer",
        output: "LONG DELIVERABLE OUTPUT",
      },
      {
        id: "c2",
        title: "Orphan",
        status: "ready",
        agentId: "bot-unknown",
        assigneeName: null,
        output: null,
      },
    ]);
  });

  it("getBoard degrades to an empty board when the gateway errors", async () => {
    gateway.workboardCardsList.mockRejectedValueOnce(new Error("offline"));
    const service = buildService();
    const team = await service.createTeam({
      name: "Docs Squad",
      memberSlugs: ["reviewer"],
    });

    const board = await service.getBoard(team.id);
    expect(board).toEqual({ boardId: team.boardId, cards: [] });
  });

  it("deleteTeam cascades the team's board cards and the board itself", async () => {
    gateway.workboardCardsList.mockResolvedValueOnce({
      cards: [
        { id: "c1", title: "a", status: "done" },
        { id: "c2", title: "b", status: "blocked" },
      ],
    });
    const service = buildService();
    const team = await service.createTeam({
      name: "Docs Squad",
      memberSlugs: ["reviewer"],
    });

    await service.deleteTeam(team.id);

    expect(gateway.workboardCardsList).toHaveBeenCalledWith({
      boardId: team.boardId,
    });
    expect(gateway.workboardCardDelete).toHaveBeenCalledWith({ id: "c1" });
    expect(gateway.workboardCardDelete).toHaveBeenCalledWith({ id: "c2" });
    expect(gateway.workboardBoardDelete).toHaveBeenCalledWith({
      id: team.boardId,
    });
  });

  it("ensureDefaultTeam creates once and reuses on subsequent calls", async () => {
    let nextId = 0;
    const service = buildService({
      genId: () => `team-id-${++nextId}`,
    });

    const first = await service.ensureDefaultTeam();
    const second = await service.ensureDefaultTeam();

    expect(first.isDefault).toBe(true);
    expect(first.members).toEqual([]);
    expect(second.id).toBe(first.id);
    expect(createBot).toHaveBeenCalledTimes(1); // one lead, not two
    expect(ledger.list().filter((team) => team.isDefault)).toHaveLength(1);
  });
});
