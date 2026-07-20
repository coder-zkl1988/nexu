import type {
  CreateTeamRequest,
  RunTeamTaskRequest,
  RunTeamTaskResponse,
  TeamBoardResponse,
  TeamMember,
  TeamResponse,
  TeamSubtaskInput,
  UpdateTeamRequest,
} from "@nexu/shared";
import { logger } from "../../lib/logger.js";
import type { ExpertLedger } from "../experthub/types.js";
import type { OpenClawGatewayService } from "../openclaw-gateway-service.js";
import type { TeamLedgerStore } from "./team-ledger.js";

/** Cap the member persona block so notes stay within the worker-context budget. */
const MAX_PERSONA_CHARS = 3_000;
/** OpenClaw truncates card notes at ~4000 chars in the worker context. */
const MAX_NOTES_CHARS = 3_800;
/** Workboard rejects comment bodies over 2000 chars ("comment body must be
 * 2000 characters or fewer", verified live) — cap the recorded reply. */
const MAX_COMMENT_CHARS = 2_000;

export class TeamNotFoundError extends Error {
  constructor(public readonly teamId: string) {
    super(`Team not found: ${teamId}`);
    this.name = "TeamNotFoundError";
  }
}

export class TeamMemberNotInstalledError extends Error {
  constructor(public readonly slug: string) {
    super(`Team member expert could not be installed: ${slug}`);
    this.name = "TeamMemberNotInstalledError";
  }
}

export class TeamAssigneeNotMemberError extends Error {
  constructor(public readonly slug: string) {
    super(`Subtask assignee is not a team member: ${slug}`);
    this.name = "TeamAssigneeNotMemberError";
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
    | "workboardCardComment"
    | "workboardCardComplete"
    | "workboardCardBlock"
    | "workboardCardDelete"
    | "workboardBoardDelete"
  >;
  /** Resolve a member expert's persona text (SOUL.md, falling back to systemPrompt). */
  resolveExpertPersona: (slug: string) => Promise<string | null>;
  /** Resolve a member expert's display name from its manifest (localized). */
  resolveExpertName: (slug: string) => Promise<string | null>;
  readExpertLedger: () => Promise<ExpertLedger>;
  /** Install an uninstalled expert so it has a bot to run as (auto-install on add). */
  installExpert: (slug: string) => Promise<void>;
  botService: {
    createBot: (input: {
      name: string;
      slug: string;
      modelId: string;
      systemPrompt?: string;
    }) => Promise<{ id: string }>;
    updateBotSystemPrompt: (
      botId: string,
      systemPrompt: string,
    ) => Promise<void>;
    deleteBot: (botId: string) => Promise<boolean>;
  };
  /**
   * Fold the lead's orchestrator persona into its AGENTS.md (the same
   * mechanism experts use — see foldPersonaIntoAgents). `bot.systemPrompt`
   * alone is NOT enough: the compiler never reads it and the live OpenClaw
   * conversation is driven entirely by workspace files, so a bot without an
   * AGENTS.md persona block just falls back to the generic default assistant.
   */
  applyLeadPersona: (leadBotId: string, persona: string) => Promise<void>;
  /** Recompile + push OpenClaw config (enables the Workboard plugin on first team). */
  syncAll: () => Promise<unknown>;
  /** Resolve the current global default model (config.runtime.defaultModelId). */
  getGlobalModelId: () => Promise<string>;
  genId: () => string;
  genBotSlug: (base: string) => string;
  /** Resolve a member expert's short description (used in the lead's roster). */
  resolveExpertDescription: (slug: string) => Promise<string | null>;
  /** Cascade-delete the team's workflows when the team is removed. */
  removeTeamWorkflows: (teamId: string) => Promise<number>;
  /**
   * Send one chat turn to a (possibly brand-new) subagent lane. Same
   * controller-driven execution primitive as the SOP engine (design doc
   * §10.3/§10.4) — completion is decided by polling the session, not by the
   * worker calling a `workboard_complete` tool (proven probabilistic).
   */
  sendChat: (input: {
    botId: string;
    sessionKey: string;
    message: string;
  }) => Promise<unknown>;
  /** Poll the lane's completion state (design doc §10.3). */
  readSessionEntry: (
    botId: string,
    sessionKey: string,
  ) => Promise<{ status?: string; sessionFile?: string } | null>;
  /** Extract the member's reply once the lane is done. */
  readAssistantReply: (sessionFile: string) => Promise<string | null>;
};

export type TeamServiceOptions = {
  /** Interval between session-status polls. */
  pollIntervalMs?: number;
  /** Per-subtask budget before the card is blocked as timed out. */
  stepTimeoutMs?: number;
  /**
   * Grace window after a lane reports `done` with no reply text. A worker
   * can end a turn on a bare tool call (e.g. it poured the whole deliverable
   * into render_a2ui), and OpenClaw may replay the queued message as a second
   * turn moments later — keep polling instead of failing instantly.
   */
  emptyDoneTimeoutMs?: number;
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
  private readonly pollIntervalMs: number;
  private readonly stepTimeoutMs: number;
  private readonly emptyDoneTimeoutMs: number;

  constructor(
    private readonly deps: TeamServiceDeps,
    options: TeamServiceOptions = {},
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? 3_000;
    this.stepTimeoutMs = options.stepTimeoutMs ?? 10 * 60_000;
    this.emptyDoneTimeoutMs = options.emptyDoneTimeoutMs ?? 60_000;
  }

  listTeams(): TeamResponse[] {
    return this.deps.ledger.list();
  }

  getTeam(teamId: string): TeamResponse | null {
    return this.deps.ledger.get(teamId);
  }

  /**
   * Public (API) view of a team. The default team's membership is dynamic —
   * every installed expert belongs to it — so it is resolved from the expert
   * ledger at read time instead of persisting a copy that drifts as experts
   * are installed/uninstalled. Execution paths already enroll assignees on
   * demand (ensureTeamMembers), so this only affects what clients see.
   */
  async resolveTeamView(team: TeamResponse): Promise<TeamResponse> {
    if (!team.isDefault) {
      return team;
    }
    const ledger = await this.deps.readExpertLedger();
    const members: TeamMember[] = await Promise.all(
      Object.entries(ledger.entries).map(async ([slug, entry]) => ({
        expertSlug: slug,
        botId: entry.botId,
        name: (await this.deps.resolveExpertName(slug)) ?? entry.name ?? slug,
      })),
    );
    return { ...team, members };
  }

  async listTeamViews(): Promise<TeamResponse[]> {
    return Promise.all(
      this.listTeams().map((team) => this.resolveTeamView(team)),
    );
  }

  async getTeamView(teamId: string): Promise<TeamResponse | null> {
    const team = this.getTeam(teamId);
    return team ? this.resolveTeamView(team) : null;
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
        boardId: team.boardId,
      });
      return {
        boardId: team.boardId,
        cards: cards.map((card) => {
          const agentId = card.agentId ?? null;
          // The workflow engine records the step reply as the FIRST comment
          // and the short completion summary after it — take the first.
          const output = card.metadata?.comments?.[0]?.body ?? null;
          return {
            id: card.id,
            title: card.title,
            status: card.status,
            agentId,
            assigneeName: agentId
              ? (memberByBotId.get(agentId)?.name ?? null)
              : null,
            output,
          };
        }),
      };
    } catch (error) {
      // Expected when the gateway is transiently offline; keep the polling UI
      // quiet but leave a debug trail rather than swallowing silently.
      logger.debug(
        {
          teamId,
          error: error instanceof Error ? error.message : String(error),
        },
        "team board fetch failed; returning empty board",
      );
      return { boardId: team.boardId, cards: [] };
    }
  }

  /**
   * Resolve member slugs to {expertSlug, botId, name}. Uninstalled experts are
   * auto-installed so each member has a real bot to run as (the Workboard card
   * assignee). Names come from the expert manifest (localized) so members render
   * correctly even when the ledger entry has no name.
   */
  private async resolveMembers(memberSlugs: string[]): Promise<TeamMember[]> {
    let ledger = await this.deps.readExpertLedger();
    const missing = memberSlugs.filter((slug) => !ledger.entries[slug]);
    for (const slug of missing) {
      try {
        await this.deps.installExpert(slug);
      } catch {
        throw new TeamMemberNotInstalledError(slug);
      }
    }
    if (missing.length > 0) {
      ledger = await this.deps.readExpertLedger();
    }
    return Promise.all(
      memberSlugs.map(async (slug) => {
        const entry = ledger.entries[slug];
        if (!entry) {
          throw new TeamMemberNotInstalledError(slug);
        }
        const name = (await this.deps.resolveExpertName(slug)) ?? entry.name;
        return { expertSlug: slug, botId: entry.botId, name };
      }),
    );
  }

  async createTeam(input: CreateTeamRequest): Promise<TeamResponse> {
    // Resolve members, auto-installing any uninstalled experts.
    const members = await this.resolveMembers(input.memberSlugs);
    const roster = await this.describeMembers(members);
    const persona = this.buildLeadSystemPrompt(input.name, roster);

    // The lead is the team's orchestrator agent (used for Phase 2 agentic
    // planning; in Phase 1 it owns the parent orchestration card). Its persona
    // identifies it as the team's coordinator and lists members so it delegates
    // instead of behaving like a generic default assistant.
    const leadBot = await this.deps.botService.createBot({
      name: `${input.name} 队长`,
      slug: this.deps.genBotSlug(`team-${input.name}`),
      // Use the current global default model (config.runtime.defaultModelId) when
      // the caller doesn't pin one — not the static env fallback.
      modelId: input.leadModelId ?? (await this.deps.getGlobalModelId()),
      systemPrompt: persona,
    });
    await this.deps.applyLeadPersona(leadBot.id, persona);

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

  /** Rename a team and/or replace its member set. */
  async updateTeam(
    teamId: string,
    input: UpdateTeamRequest,
  ): Promise<TeamResponse> {
    const team = this.requireTeam(teamId);
    const members = input.memberSlugs
      ? await this.resolveMembers(input.memberSlugs)
      : team.members;
    const name = input.name ?? team.name;

    // Keep the lead's persona (name + member roster) in sync so it never falls
    // back to describing a stale team after a rename or membership change.
    if (input.name !== undefined || input.memberSlugs !== undefined) {
      const roster = await this.describeMembers(members);
      const persona = this.buildLeadSystemPrompt(name, roster);
      await this.deps.botService.updateBotSystemPrompt(team.leadBotId, persona);
      await this.deps.applyLeadPersona(team.leadBotId, persona);
    }

    const updated: TeamResponse = {
      ...team,
      name,
      members,
      updatedAt: new Date().toISOString(),
    };
    await this.deps.ledger.upsert(updated);
    // Member set affects the compiled OpenClaw config (board assignees).
    await this.deps.syncAll();
    return updated;
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
      // Workflows are meaningless without their team — cascade them.
      await this.deps.removeTeamWorkflows(teamId).catch(() => 0);
      // Cascade the team's Workboard namespace: the store refuses to delete
      // a board while cards remain, so clear cards first. Best-effort — a
      // transiently offline gateway must not block team deletion.
      try {
        const { cards } = await this.deps.gateway.workboardCardsList({
          boardId: team.boardId,
        });
        for (const card of cards) {
          await this.deps.gateway
            .workboardCardDelete({ id: card.id })
            .catch(() => undefined);
        }
        await this.deps.gateway.workboardBoardDelete({ id: team.boardId });
      } catch (error) {
        logger.debug(
          {
            teamId,
            error: error instanceof Error ? error.message : String(error),
          },
          "team board cascade cleanup skipped",
        );
      }
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

  /**
   * The system default team: lazily created the first time a plain bot
   * dispatches work without a team (expert_run_auto). Idempotent — one
   * default team per install, marked `isDefault` in the ledger.
   */
  async ensureDefaultTeam(): Promise<TeamResponse> {
    const existing = this.deps.ledger.list().find((team) => team.isDefault);
    if (existing) {
      return existing;
    }
    const created = await this.createTeam({
      name: "默认专家团",
      memberSlugs: [],
    });
    const marked: TeamResponse = { ...created, isDefault: true };
    await this.deps.ledger.upsert(marked);
    return marked;
  }

  private requireTeam(teamId: string): TeamResponse {
    const team = this.deps.ledger.get(teamId);
    if (!team) {
      throw new TeamNotFoundError(teamId);
    }
    return team;
  }

  /**
   * Deterministic board execution shared by manual and agentic runs: create
   * the board + parent card, decompose into member cards with persona
   * injected into notes, then drive each card directly over `chat.send` to a
   * dedicated subagent lane. The endpoint returns as soon as every turn has
   * been dispatched; completion is decided in the background by the
   * controller polling the lane's session status — not by the worker calling
   * a `workboard_complete` tool, which design doc §10.4 proved is only
   * probabilistic (the same model can call it on one run and skip it on the
   * next).
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
      boardId: team.boardId,
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
          boardId: team.boardId,
          agentId: member.botId,
          notes: this.buildCardNotes(
            personaBySlug.get(subtask.assigneeSlug) ?? "",
            subtask.notes,
          ),
        };
      }),
    });

    const started: Array<{ cardId: string; sessionKey: string }> = [];
    const runs: Array<Promise<void>> = [];
    valid.forEach((subtask, index) => {
      const member = memberBySlug.get(subtask.assigneeSlug);
      const child = children[index];
      if (!member || !child) {
        return;
      }
      const sessionKey = `agent:${member.botId}:subagent:task-${child.id}`;
      started.push({ cardId: child.id, sessionKey });
      runs.push(
        this.runSubtaskCard({
          cardId: child.id,
          botId: member.botId,
          sessionKey,
          persona: personaBySlug.get(subtask.assigneeSlug) ?? "",
          title: subtask.title,
          taskNotes: subtask.notes,
        }),
      );
    });
    // Fire-and-forget: the endpoint returns immediately; the board (existing
    // getBoard polling) is the source of truth for progress.
    void Promise.allSettled(runs);

    return {
      boardId: team.boardId,
      parentCardId: parentCard.id,
      started,
    };
  }

  /** Drive one subtask card to completion: chat.send → poll → comment + complete. */
  private async runSubtaskCard(input: {
    cardId: string;
    botId: string;
    sessionKey: string;
    persona: string;
    title: string;
    taskNotes?: string;
  }): Promise<void> {
    const { cardId, botId, sessionKey, persona, title, taskNotes } = input;
    const task = taskNotes?.trim() ? `${title}\n${taskNotes.trim()}` : title;
    const message = [
      persona.trim()
        ? `[PERSONA — follow this exactly for your entire reply]\n${persona.trim()}\n`
        : "",
      `[TASK]\n${task}`,
      "",
      // "plain text" matters: a worker that pours the deliverable into a UI
      // tool (render_a2ui) ends its turn with no reply text to harvest.
      "Reply with the deliverable itself only, as plain text — no preamble, no meta commentary, no questions back, and do NOT render UI (no render_a2ui).",
    ]
      .filter(Boolean)
      .join("\n");

    await this.deps.gateway.workboardCardMove({
      id: cardId,
      status: "running",
    });

    try {
      await this.deps.sendChat({ botId, sessionKey, message });
      const reply = await this.awaitLaneReply(botId, sessionKey);
      await this.deps.gateway.workboardCardComment({
        id: cardId,
        body: reply.slice(0, MAX_COMMENT_CHARS),
      });
      await this.deps.gateway.workboardCardComplete({
        id: cardId,
        summary: "done",
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await this.deps.gateway
        .workboardCardBlock({ id: cardId, reason })
        .catch(() => undefined);
      logger.error(
        { cardId, sessionKey, error: reason },
        "team subtask card failed",
      );
    }
  }

  /** Poll the lane's session entry until done, then read the reply. */
  private async awaitLaneReply(
    botId: string,
    sessionKey: string,
  ): Promise<string> {
    const deadline = Date.now() + this.stepTimeoutMs;
    // First time we saw `done` with no reply text yet. A turn can end on a
    // bare tool call, and the lane may still run a queued follow-up turn —
    // keep polling within a grace window instead of failing on first sight.
    let emptyDoneSince: number | null = null;
    while (Date.now() < deadline) {
      const entry = await this.deps.readSessionEntry(botId, sessionKey);
      if (entry?.status === "done") {
        const reply = entry.sessionFile
          ? await this.deps.readAssistantReply(entry.sessionFile)
          : null;
        if (reply?.trim()) {
          return reply.trim();
        }
        emptyDoneSince ??= Date.now();
        if (Date.now() - emptyDoneSince >= this.emptyDoneTimeoutMs) {
          throw new Error(
            `subtask session finished without a reply: ${sessionKey}`,
          );
        }
      } else {
        emptyDoneSince = null; // a new turn started — reset the grace window
      }
      if (entry?.status === "failed") {
        throw new Error(`subtask session failed: ${sessionKey}`);
      }
      await sleep(this.pollIntervalMs);
    }
    throw new Error(`subtask timed out after ${this.stepTimeoutMs}ms`);
  }

  /** Resolve each member's display name + short description for the lead's roster. */
  private async describeMembers(
    members: readonly TeamMember[],
  ): Promise<Array<{ name: string; description: string }>> {
    return Promise.all(
      members.map(async (member) => ({
        name: member.name ?? member.expertSlug,
        description:
          (await this.deps.resolveExpertDescription(member.expertSlug)) ?? "",
      })),
    );
  }

  /**
   * The lead bot's systemPrompt: identifies it as the team's coordinator and
   * lists members so it delegates to the right specialist instead of behaving
   * like a generic default assistant (it otherwise gets no custom persona).
   */
  private buildLeadSystemPrompt(
    teamName: string,
    members: ReadonlyArray<{ name: string; description: string }>,
  ): string {
    const roster =
      members
        .map((m) => `- ${m.name}${m.description ? `：${m.description}` : ""}`)
        .join("\n") || "(暂无成员)";
    return [
      `你是「${teamName}」团队的队长（协调者），负责统筹团队完成用户交给的任务。`,
      "",
      "## 团队成员",
      roster,
      "",
      "## 你的职责",
      "- 需要成员实际产出工作（成稿、方案、分析等）或多人分工的任务：调用 team_run_auto 派发到团队看板（自动拆解、进度运行卡会展示给用户），启动后只需一句话确认，不要复述计划。",
      "- 用户点名要跑某个已保存的工作流/SOP：用 team_list_workflows 查到 id 后调用 team_run_workflow。",
      "- 只需要某一位成员轻量口头解答、无需产出交付物时：可用 sessions_spawn 委派该成员并转述结果。",
      "- 简单、通用或闲聊类问题：不要委派，直接自己回答。",
      "- 不要把琐碎的子步骤都拆给成员——只有真正需要成员专长时才派发。",
      `- 有人问你是谁/能做什么时，只介绍你是「${teamName}」的队长、团队成员及各自专长；**不要**罗列 AGENTS.md「首次接触」步骤里提到的通用技能清单（搜索、邮件、日历、手机控制、绘图等）——那是给普通 bot 用的，你的能力介绍应该聚焦团队本身。`,
    ].join("\n");
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
