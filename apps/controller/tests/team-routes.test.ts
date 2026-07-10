import type {
  RunTeamWorkflowResponse,
  TeamResponse,
  WorkflowStep,
} from "@nexu/shared";
import { runAutoTeamTaskResponseSchema } from "@nexu/shared";
import { describe, expect, it, vi } from "vitest";
import {
  type TeamRoutesDeps,
  buildTeamRoutes,
} from "../src/routes/team-routes.js";
import { TeamNotFoundError } from "../src/services/teams/team-service.js";
import { WorkflowValidationError } from "../src/services/teams/team-workflow-service.js";

const TEAM: TeamResponse = {
  id: "team-default",
  name: "默认专家团",
  leadBotId: "bot-lead",
  members: [
    { expertSlug: "researcher", botId: "bot-researcher", name: "Researcher" },
    { expertSlug: "writer", botId: "bot-writer", name: "Writer" },
  ],
  boardId: "team-team-default",
  isDefault: true,
  createdAt: "2026-07-07T00:00:00.000Z",
  updatedAt: "2026-07-07T00:00:00.000Z",
};

const STEPS: WorkflowStep[] = [
  {
    id: "research",
    type: "task",
    assigneeSlug: "researcher",
    name: "调研",
    task: "Research the topic.",
    output: "research_output",
    dependsOn: [],
  },
  {
    id: "write",
    type: "task",
    assigneeSlug: "writer",
    name: "撰写",
    task: "Write from:\n{{research_output}}",
    output: "final_output",
    dependsOn: ["research"],
  },
];

const AUTO_RESULT: RunTeamWorkflowResponse & { steps: WorkflowStep[] } = {
  runId: "run-1",
  boardId: TEAM.boardId,
  parentCardId: "card-parent",
  cards: [
    { stepId: "research", cardId: "card-1" },
    { stepId: "write", cardId: "card-2" },
  ],
  steps: STEPS,
};

function buildDeps(
  overrides: {
    ensureDefaultTeam?: TeamRoutesDeps["teamService"]["ensureDefaultTeam"];
    autoComposeAndRun?: TeamRoutesDeps["teamWorkflowService"]["autoComposeAndRun"];
  } = {},
): TeamRoutesDeps {
  return {
    teamService: {
      listTeams: vi.fn(),
      getTeam: vi.fn(),
      getBoard: vi.fn(),
      createTeam: vi.fn(),
      updateTeam: vi.fn(),
      deleteTeam: vi.fn(),
      runTask: vi.fn(),
      ensureDefaultTeam: overrides.ensureDefaultTeam ?? vi.fn(async () => TEAM),
    },
    teamWorkflowService: {
      autoComposeAndRun:
        overrides.autoComposeAndRun ?? vi.fn(async () => AUTO_RESULT),
    },
  };
}

describe("POST /teams/default/run-auto", () => {
  it("ensures the default team, composes+runs the DAG, and returns the run shape", async () => {
    const ensureDefaultTeam = vi.fn(async () => TEAM);
    const autoComposeAndRun = vi.fn(async () => AUTO_RESULT);
    const app = buildTeamRoutes(
      buildDeps({ ensureDefaultTeam, autoComposeAndRun }),
    );

    const res = await app.request("/default/run-auto", {
      method: "POST",
      headers: { "content-type": "application/json" },
      // maxSubtasks is accepted but ignored (the composer is one-sentence).
      body: JSON.stringify({ task: "调研并写报告", maxSubtasks: 5 }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ...AUTO_RESULT, teamId: TEAM.id });
    // Response conforms to the new auto-run schema (teamId + steps + runId).
    expect(runAutoTeamTaskResponseSchema.safeParse(json).success).toBe(true);

    expect(ensureDefaultTeam).toHaveBeenCalledTimes(1);
    expect(autoComposeAndRun).toHaveBeenCalledWith(TEAM.id, "调研并写报告");
  });

  it("maps a compose/validation failure to 400", async () => {
    const autoComposeAndRun = vi.fn(async () => {
      throw new WorkflowValidationError("composed draft is malformed");
    });
    const app = buildTeamRoutes(buildDeps({ autoComposeAndRun }));

    const res = await app.request("/default/run-auto", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task: "nonsense" }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      message: "composed draft is malformed",
    });
  });

  it("degrades an upstream compose/gateway failure to 502", async () => {
    const autoComposeAndRun = vi.fn(async () => {
      throw new Error(
        "workflow compose completion failed: 503 Service Unavailable",
      );
    });
    const app = buildTeamRoutes(buildDeps({ autoComposeAndRun }));

    const res = await app.request("/default/run-auto", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task: "调研并写报告" }),
    });

    expect(res.status).toBe(502);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("运行启动失败，请稍后重试");
    // The raw upstream error/status must never reach the client.
    expect(body.message).not.toContain("503");
    expect(body.message).not.toContain("compose completion failed");
  });
});

describe("POST /teams/{id}/run-auto", () => {
  it("composes+runs the DAG on the named team and returns the run shape", async () => {
    const autoComposeAndRun = vi.fn(async () => AUTO_RESULT);
    const app = buildTeamRoutes(buildDeps({ autoComposeAndRun }));

    const res = await app.request("/my-team/run-auto", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task: "写一篇" }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ...AUTO_RESULT, teamId: "my-team" });
    expect(runAutoTeamTaskResponseSchema.safeParse(json).success).toBe(true);
    expect(autoComposeAndRun).toHaveBeenCalledWith("my-team", "写一篇");
  });

  it("maps an unknown team to 404", async () => {
    const autoComposeAndRun = vi.fn(async () => {
      throw new TeamNotFoundError("ghost");
    });
    const app = buildTeamRoutes(buildDeps({ autoComposeAndRun }));

    const res = await app.request("/ghost/run-auto", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task: "x" }),
    });

    expect(res.status).toBe(404);
  });

  it("maps a compose/validation failure to 400", async () => {
    const autoComposeAndRun = vi.fn(async () => {
      throw new WorkflowValidationError("dependency cycle involving: a, b");
    });
    const app = buildTeamRoutes(buildDeps({ autoComposeAndRun }));

    const res = await app.request("/my-team/run-auto", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task: "x" }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      message: "dependency cycle involving: a, b",
    });
  });

  it("degrades an upstream compose/gateway failure to 502", async () => {
    const autoComposeAndRun = vi.fn(async () => {
      throw new Error(
        "workflow compose completion failed: 503 Service Unavailable",
      );
    });
    const app = buildTeamRoutes(buildDeps({ autoComposeAndRun }));

    const res = await app.request("/my-team/run-auto", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task: "x" }),
    });

    expect(res.status).toBe(502);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("运行启动失败，请稍后重试");
    // The raw upstream error/status must never reach the client.
    expect(body.message).not.toContain("503");
    expect(body.message).not.toContain("compose completion failed");
  });
});
