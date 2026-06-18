import type {
  AutoRunTeamTaskRequest,
  AutoRunTeamTaskResponse,
  CreateTeamRequest,
  RunTeamTaskRequest,
  RunTeamTaskResponse,
  TeamBoardResponse,
  TeamMember,
  TeamResponse,
  TeamSubtaskInput,
} from "@nexu/shared";
import type { ExpertLedger } from "../experthub/types.js";
import type { OpenClawGatewayService } from "../openclaw-gateway-service.js";
import type { TeamLedgerStore } from "./team-ledger.js";
import type { TeamPlanner, TeamPlannerMember } from "./team-planner.js";

/** Cap the member persona block so notes stay within the worker-context budget. */
const MAX_PERSONA_CHARS = 3_000;
/** OpenClaw truncates card notes at ~4000 chars in the worker context. */
const MAX_NOTES_CHARS = 3_800;

export class TeamNotFoundError extends Error {
  constructor(public readonly teamId: string) {
    super(`Team not found: ${teamId}`);
    this.name = "TeamNotFoundError";
  }
}

export class TeamMemberNotInstalledError extends Error {
  constructor(public readonly slug: string) {
    super(`Team member expert is not installed: ${slug}`);
    this.name = "TeamMemberNotInstalledError";
  }
}

export class TeamAssigneeNotMemberError extends Error {
  constructor(public readonly slug: string) {
    super(`Subtask assignee is not a team member: ${slug}`);
    this.name = "TeamAssigneeNotMemberError";
  }
}

export class TeamPlanFailedError extends Error {
  constructor(public readonly teamId: string) {
    super(`The lead could not produce a task plan for team: ${teamId}`);
    this.name = "TeamPlanFailedError";
  }
}

export type TeamServiceDeps = {
  ledger: TeamLedgerStore;
  gateway: Pick<
    OpenClawGatewayService,
    | "workboardBoardUpsert"
    | "workboardCardCreate"
    | "workboardCardDecompose"
    | "workboardCardMove"
    | "workboardCardsList"
    | "workboardDispatch"
  >;
  /** Resolve a member expert's persona text (SOUL.md, falling back to systemPrompt). */
  resolveExpertPersona: (slug: string) => Promise<string | null>;
  readExpertLedger: () => Promise<ExpertLedger>;
  botService: {
    createBot: (input: {
      name: string;
      slug: string;
      modelId: string;
    }) => Promise<{ id: string }>;
    deleteBot: (botId: string) => Promise<boolean>;
  };
  /** Recompile + push OpenClaw config (enables the Workboard plugin on first team). */
  syncAll: () => Promise<unknown>;
  defaultModelId: string;
  genId: () => string;
  genBotSlug: (base: string) => string;
  /** Agentic decomposition (Phase 2): the lead's model plans the subtasks. */
  planner: Pick<TeamPlanner, "planSubtasks">;
  /** Resolve a bot's configured model ref (used as the planning model). */
  getBotModel: (botId: string) => Promise<string | null>;
  /** Resolve a member expert's short description (used in the planning roster). */
  resolveExpertDescription: (slug: string) => Promise<string | null>;
};

/**
 * Owns the team lifecycle and task execution.
 *
 * Execution model (see specs/design-docs/2026-06-15-nexu-orchestrator-plugin.md
 * §8c): Workboard is the task board/state layer only. The dispatcher worker
 * runs as the member agent (`card.agentId = member botId`) but does NOT load
 * that agent's AGENTS.md persona, so each member's persona is injected into
 * `card.notes` instead.
 */
export class TeamService {
  constructor(private readonly deps: TeamServiceDeps) {}

  listTeams(): TeamResponse[] {
    return this.deps.ledger.list();
  }

  getTeam(teamId: string): TeamResponse | null {
    return this.deps.ledger.get(teamId);
  }

  /**
   * Live snapshot of the team's Workboard for the Kanban view. Degrades to an
   * empty board when the gateway is offline or the board has no cards yet, so
   * the polling UI never error-spams.
   */
  async getBoard(teamId: string): Promise<TeamBoardResponse> {
    const team = this.requireTeam(teamId);
    const memberByBotId = new Map(team.members.map((m) => [m.botId, m]));
    try {
      const { cards } = await this.deps.gateway.workboardCardsList({
        board: team.boardId,
      });
      return {
        boardId: team.boardId,
        cards: cards.map((card) => {
          const agentId = card.agentId ?? null;
          return {
            id: card.id,
            title: card.title,
            status: card.status,
            agentId,
            assigneeName: agentId
              ? (memberByBotId.get(agentId)?.name ?? null)
              : null,
          };
        }),
      };
    } catch {
      return { boardId: team.boardId, cards: [] };
    }
  }

  async createTeam(input: CreateTeamRequest): Promise<TeamResponse> {
    // Resolve members from the experthub ledger; all members must be installed.
    const expertLedger = await this.deps.readExpertLedger();
    const members: TeamMember[] = input.memberSlugs.map((slug) => {
      const entry = expertLedger.entries[slug];
      if (!entry) {
        throw new TeamMemberNotInstalledError(slug);
      }
      return { expertSlug: slug, botId: entry.botId, name: entry.name };
    });

    // The lead is the team's orchestrator agent (used for Phase 2 agentic
    // planning; in Phase 1 it owns the parent orchestration card).
    const leadBot = await this.deps.botService.createBot({
      name: `${input.name} 队长`,
      slug: this.deps.genBotSlug(`team-${input.name}`),
      modelId: input.leadModelId ?? this.deps.defaultModelId,
    });

    const teamId = this.deps.genId();
    const now = new Date().toISOString();
    const team: TeamResponse = {
      id: teamId,
      name: input.name,
      leadBotId: leadBot.id,
      members,
      boardId: `team-${teamId}`,
      createdAt: now,
      updatedAt: now,
    };
    await this.deps.ledger.upsert(team);

    // Recompile so the Workboard plugin is enabled now that a team exists.
    // (createBot already synced once; this picks up hasTeams=true.)
    await this.deps.syncAll();
    return team;
  }

  async deleteTeam(teamId: string): Promise<boolean> {
    const team = this.deps.ledger.get(teamId);
    if (!team) {
      return false;
    }
    // The lead bot is owned by the team; members are shared experts and stay.
    try {
      await this.deps.botService.deleteBot(team.leadBotId);
    } catch {
      // Lead bot may already be gone.
    }
    const removed = await this.deps.ledger.remove(teamId);
    if (removed) {
      await this.deps.syncAll();
    }
    return removed;
  }

  /** Phase 1: caller supplies the subtask breakdown explicitly. */
  async runTask(
    teamId: string,
    input: RunTeamTaskRequest,
  ): Promise<RunTeamTaskResponse> {
    const team = this.requireTeam(teamId);

    const memberSlugs = new Set(team.members.map((m) => m.expertSlug));
    for (const subtask of input.subtasks) {
      if (!memberSlugs.has(subtask.assigneeSlug)) {
        throw new TeamAssigneeNotMemberError(subtask.assigneeSlug);
      }
    }

    return this.dispatchSubtasks(team, input.task, input.subtasks);
  }

  /** Phase 2: the lead's model decomposes the task; the controller dispatches. */
  async runTaskAuto(
    teamId: string,
    input: AutoRunTeamTaskRequest,
  ): Promise<AutoRunTeamTaskResponse> {
    const team = this.requireTeam(teamId);

    const roster: TeamPlannerMember[] = await Promise.all(
      team.members.map(async (member) => ({
        slug: member.expertSlug,
        name: member.name ?? member.expertSlug,
        description:
          (await this.deps.resolveExpertDescription(member.expertSlug)) ?? "",
      })),
    );

    const model =
      (await this.deps.getBotModel(team.leadBotId)) ?? this.deps.defaultModelId;

    const plan = await this.deps.planner.planSubtasks({
      task: input.task,
      members: roster,
      model,
      maxSubtasks: input.maxSubtasks,
    });
    if (plan.length === 0) {
      throw new TeamPlanFailedError(teamId);
    }

    const result = await this.dispatchSubtasks(team, input.task, plan);
    return { ...result, plan };
  }

  private requireTeam(teamId: string): TeamResponse {
    const team = this.deps.ledger.get(teamId);
    if (!team) {
      throw new TeamNotFoundError(teamId);
    }
    return team;
  }

  /**
   * Deterministic board execution shared by manual and agentic runs: create the
   * board + parent card, decompose into member cards with persona injected into
   * notes, promote to ready, and dispatch.
   */
  private async dispatchSubtasks(
    team: TeamResponse,
    task: string,
    subtasks: readonly TeamSubtaskInput[],
  ): Promise<RunTeamTaskResponse> {
    const memberBySlug = new Map(team.members.map((m) => [m.expertSlug, m]));
    const valid = subtasks.filter((s) => memberBySlug.has(s.assigneeSlug));

    // Persona is resolved once per distinct assignee and reused across subtasks.
    const personaBySlug = new Map<string, string>();
    for (const slug of new Set(valid.map((s) => s.assigneeSlug))) {
      personaBySlug.set(slug, await this.resolvePersonaBlock(slug));
    }

    await this.deps.gateway.workboardBoardUpsert({
      id: team.boardId,
      name: team.name,
    });

    const { card: parentCard } = await this.deps.gateway.workboardCardCreate({
      title: task,
      board: team.boardId,
      agentId: team.leadBotId,
      priority: "high",
    });

    const { children } = await this.deps.gateway.workboardCardDecompose({
      id: parentCard.id,
      children: valid.map((subtask) => {
        // biome-ignore lint/style/noNonNullAssertion: filtered to members above
        const member = memberBySlug.get(subtask.assigneeSlug)!;
        return {
          title: subtask.title,
          agentId: member.botId,
          notes: this.buildCardNotes(
            personaBySlug.get(subtask.assigneeSlug) ?? "",
            subtask.notes,
          ),
        };
      }),
    });

    // Children are created as `todo`; the dispatcher only starts `ready` cards.
    await Promise.all(
      children.map((child) =>
        this.deps.gateway.workboardCardMove({ id: child.id, status: "ready" }),
      ),
    );

    const dispatch = await this.deps.gateway.workboardDispatch({
      board: team.boardId,
    });

    return {
      boardId: team.boardId,
      parentCardId: parentCard.id,
      started: dispatch.started.map((s) => ({
        cardId: s.cardId,
        sessionKey: s.sessionKey,
      })),
    };
  }

  private async resolvePersonaBlock(slug: string): Promise<string> {
    const persona = await this.deps.resolveExpertPersona(slug);
    if (!persona) {
      return "";
    }
    return persona.slice(0, MAX_PERSONA_CHARS);
  }

  private buildCardNotes(personaBlock: string, taskNotes?: string): string {
    const sections: string[] = [];
    if (personaBlock.trim()) {
      sections.push(
        `[PERSONA — follow this exactly for your entire reply]\n${personaBlock.trim()}`,
      );
    }
    if (taskNotes?.trim()) {
      sections.push(`[TASK]\n${taskNotes.trim()}`);
    }
    return sections.join("\n\n").slice(0, MAX_NOTES_CHARS);
  }
}
