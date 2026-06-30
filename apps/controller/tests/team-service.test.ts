import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExpertLedger } from "../src/services/experthub/types.js";
import { TeamLedgerStore } from "../src/services/teams/team-ledger.js";
import {
  TeamAssigneeNotMemberError,
  TeamMemberNotInstalledError,
  TeamPlanFailedError,
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
    workboardDispatch: ReturnType<typeof vi.fn>;
  };
  let syncAll: ReturnType<typeof vi.fn>;
  let createBot: ReturnType<typeof vi.fn>;
  let planSubtasks: ReturnType<typeof vi.fn>;
  let installExpert: ReturnType<typeof vi.fn>;
  let mockExpertLedger: ExpertLedger;

  function buildService(overrides: Partial<TeamServiceDeps> = {}): TeamService {
    return new TeamService({
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
        deleteBot: vi.fn(async () => true),
      },
      syncAll,
      defaultModelId: "link/default",
      genId: () => "team-id-1",
      genBotSlug: (base) => `${base}-slug`,
      planner: { planSubtasks },
      getBotModel: async () => "link/lead-model",
      resolveExpertDescription: async (slug) => `desc of ${slug}`,
      ...overrides,
    });
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
      workboardDispatch: vi.fn(async () => ({
        started: [
          {
            cardId: "child-0",
            sessionKey:
              "agent:bot-reviewer:subagent:workboard-team-id-1-child-0",
            runId: "run-1",
          },
        ],
      })),
    };
    syncAll = vi.fn(async () => undefined);
    createBot = vi.fn(async () => ({ id: "bot-lead" }));
    planSubtasks = vi.fn(async () => [
      { title: "Review the diff", assigneeSlug: "reviewer" },
    ]);
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
  });

  it("runTask decomposes into member cards with persona injected into notes, then dispatches", async () => {
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
      board: team.boardId,
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

    // Children promoted to ready, then dispatched.
    expect(gateway.workboardCardMove).toHaveBeenCalledTimes(2);
    expect(gateway.workboardDispatch).toHaveBeenCalledWith({
      board: team.boardId,
    });
    expect(result.parentCardId).toBe("parent-1");
    expect(result.started).toEqual([
      {
        cardId: "child-0",
        sessionKey: "agent:bot-reviewer:subagent:workboard-team-id-1-child-0",
      },
    ]);
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

  it("runTask dispatches across multiple passes until all cards start", async () => {
    // The dispatcher starts a capped batch per pass; the service loops to start
    // the rest. Mock distinct started cards per pass for the two subtasks.
    gateway.workboardDispatch
      .mockResolvedValueOnce({
        started: [{ cardId: "child-0", sessionKey: "k0" }],
      })
      .mockResolvedValueOnce({
        started: [{ cardId: "child-1", sessionKey: "k1" }],
      });
    const service = buildService();
    const team = await service.createTeam({
      name: "Docs Squad",
      memberSlugs: ["reviewer", "writer"],
    });

    const result = await service.runTask(team.id, {
      task: "ship",
      subtasks: [
        { title: "a", assigneeSlug: "reviewer" },
        { title: "b", assigneeSlug: "writer" },
      ],
    });

    expect(gateway.workboardDispatch).toHaveBeenCalledTimes(2);
    expect(result.started).toEqual([
      { cardId: "child-0", sessionKey: "k0" },
      { cardId: "child-1", sessionKey: "k1" },
    ]);
  });

  it("runTaskAuto plans via the lead model then dispatches the plan", async () => {
    const service = buildService();
    const team = await service.createTeam({
      name: "Docs Squad",
      memberSlugs: ["reviewer", "writer"],
    });

    const result = await service.runTaskAuto(team.id, {
      task: "Ship the release notes",
    });

    // The planner is called with the team roster and the lead model.
    expect(planSubtasks).toHaveBeenCalledTimes(1);
    const plannerArg = planSubtasks.mock.calls[0][0];
    expect(plannerArg.task).toBe("Ship the release notes");
    expect(plannerArg.model).toBe("link/lead-model");
    expect(plannerArg.members.map((m: { slug: string }) => m.slug)).toEqual([
      "reviewer",
      "writer",
    ]);

    // The generated plan is dispatched with persona injected into notes.
    const decomposeArg = gateway.workboardCardDecompose.mock.calls[0][0];
    expect(decomposeArg.children[0].agentId).toBe("bot-reviewer");
    expect(decomposeArg.children[0].notes).toContain("Code Sentinel");
    expect(result.plan).toEqual([
      { title: "Review the diff", assigneeSlug: "reviewer" },
    ]);
    expect(result.started).toHaveLength(1);
  });

  it("runTaskAuto throws when the lead returns an empty plan", async () => {
    planSubtasks.mockResolvedValueOnce([]);
    const service = buildService();
    const team = await service.createTeam({
      name: "Docs Squad",
      memberSlugs: ["reviewer"],
    });

    await expect(
      service.runTaskAuto(team.id, { task: "vague" }),
    ).rejects.toBeInstanceOf(TeamPlanFailedError);
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
      board: team.boardId,
    });
    expect(board.boardId).toBe(team.boardId);
    expect(board.cards).toEqual([
      {
        id: "p",
        title: "Audit",
        status: "todo",
        agentId: "bot-lead",
        assigneeName: null,
      },
      {
        id: "c1",
        title: "Review",
        status: "running",
        agentId: "bot-reviewer",
        assigneeName: "Code Reviewer",
      },
      {
        id: "c2",
        title: "Orphan",
        status: "ready",
        agentId: "bot-unknown",
        assigneeName: null,
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
});
