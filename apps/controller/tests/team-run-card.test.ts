import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// The nexu-team runtime plugin builds the A2UI run card. Import the real
// builder so this guards the exact payload the chat UI renders.
import teamPlugin, {
  buildTeamRunCard,
} from "../static/runtime-plugins/nexu-team/index.js";

type RunCardComponent = {
  id: string;
  type: string;
  run?: {
    teamId: string;
    boardId: string;
    parentCardId: string;
    title: string;
    runId?: string;
    workflowId?: string;
    steps: Array<{
      id: string;
      name: string;
      assigneeName: string;
      cardId: string;
      dependsOn: string[];
      type?: string;
    }>;
  };
};

type A2UIMessage = {
  createSurface?: {
    surfaceId: string;
    catalogId?: string;
    components?: RunCardComponent[];
  };
  updateComponents?: {
    surfaceId: string;
    components: RunCardComponent[];
  };
};

function parse(jsonl: string): A2UIMessage[] {
  return jsonl.split("\n").map((line) => JSON.parse(line));
}

/** Components arrive inline on createSurface (v1.0 form) or via updateComponents. */
function findComponents(messages: A2UIMessage[]): RunCardComponent[] {
  return messages.flatMap(
    (m) => m.createSurface?.components ?? m.updateComponents?.components ?? [],
  );
}

describe("buildTeamRunCard", () => {
  const jsonl = buildTeamRunCard({
    teamId: "team-1",
    boardId: "team-team-1",
    parentCardId: "parent-1",
    runId: "run-1",
    workflowId: "wf-1",
    title: "小红书爆款笔记",
    steps: [
      {
        id: "draft",
        name: "写初稿",
        assigneeName: "小红书专家",
        cardId: "card-a",
        dependsOn: [],
      },
      {
        id: "gate",
        name: "人工审核",
        assigneeName: "小红书运营专家",
        cardId: "card-b",
        dependsOn: ["draft"],
        type: "approval",
      },
    ],
  });
  const messages = parse(jsonl);

  it("creates the surface on Nexu's custom A2UI catalog", () => {
    const create = messages.find((m) => m.createSurface)?.createSurface;
    expect(create?.surfaceId).toBe("team-run-parent-1");
    expect(create?.catalogId).toBe("https://nexu.app/a2ui/custom-catalog.json");
  });

  it("emits a TeamRunCard component carrying the full run identity + steps", () => {
    const component = findComponents(messages)[0];
    expect(component?.type).toBe("TeamRunCard");
    expect(component?.run).toMatchObject({
      teamId: "team-1",
      boardId: "team-team-1",
      parentCardId: "parent-1",
      runId: "run-1",
      workflowId: "wf-1",
      title: "小红书爆款笔记",
    });
    expect(component?.run?.steps).toEqual([
      {
        id: "draft",
        name: "写初稿",
        assigneeName: "小红书专家",
        cardId: "card-a",
        dependsOn: [],
      },
      {
        id: "gate",
        name: "人工审核",
        assigneeName: "小红书运营专家",
        cardId: "card-b",
        dependsOn: ["draft"],
        type: "approval",
      },
    ]);
  });

  it("omits runId/workflowId for auto runs (no approvals to poll)", () => {
    const autoJsonl = buildTeamRunCard({
      teamId: "team-1",
      boardId: "board",
      parentCardId: "p2",
      title: "auto",
      steps: [],
    });
    const component = findComponents(parse(autoJsonl))[0];
    expect(component?.run).not.toHaveProperty("runId");
    expect(component?.run).not.toHaveProperty("workflowId");
  });
});

// expert_run_auto is the teamless entry point. T3 made /teams/default/run-auto
// return the composed DAG ({ teamId, runId, cards, steps:[{ dependsOn }] }); the
// handler must map each step to its board card and preserve the real edges — the
// same card shape team_run_workflow emits.
type ToolResult = {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
};
type ExpertTool = {
  name: string;
  execute: (
    toolCallId: string,
    params: { task: string },
  ) => Promise<ToolResult>;
};

function autoRunFetch() {
  const runAuto = {
    teamId: "default-team",
    runId: "run-9",
    boardId: "team-default-team",
    parentCardId: "parent-9",
    cards: [
      { stepId: "search", cardId: "card-search" },
      { stepId: "analyze", cardId: "card-analyze" },
      { stepId: "generate", cardId: "card-generate" },
    ],
    steps: [
      {
        id: "search",
        type: "task",
        assigneeSlug: "researcher",
        name: "搜索",
        task: "搜索资料",
        dependsOn: [],
      },
      {
        id: "analyze",
        type: "task",
        assigneeSlug: "analyst",
        name: "分析",
        task: "分析 {{search}}",
        dependsOn: ["search"],
      },
      {
        id: "generate",
        type: "task",
        assigneeSlug: "writer",
        name: "生成",
        task: "生成 {{analyze}}",
        dependsOn: ["analyze"],
      },
    ],
  };
  const teamDetail = {
    id: "default-team",
    members: [
      { expertSlug: "researcher", name: "搜索专家" },
      { expertSlug: "analyst", name: "分析专家" },
      { expertSlug: "writer", name: "生成专家" },
    ],
  };
  const respond = (data: unknown) => ({
    ok: true,
    status: 200,
    json: async () => data,
  });
  return async (input: string) => {
    const url = String(input);
    if (url.includes("/run-auto")) return respond(runAuto);
    // Lead guard: this agent leads no team, so expert_run_auto is allowed.
    if (url.endsWith("/api/v1/teams")) return respond({ teams: [] });
    if (url.includes("/api/v1/teams/")) return respond(teamDetail);
    return respond({});
  };
}

describe("expert_run_auto run card", () => {
  let registerFactory: ((ctx: { agentId: string }) => ExpertTool[]) | undefined;

  beforeEach(() => {
    registerFactory = undefined;
    teamPlugin.register({
      pluginConfig: { controllerUrl: "http://ctrl.test" },
      registerTool: (factory: (ctx: { agentId: string }) => ExpertTool[]) => {
        registerFactory = factory;
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("carries real dependsOn + cardId mapped from the auto DAG response", async () => {
    vi.stubGlobal("fetch", autoRunFetch());
    const tools = registerFactory?.({ agentId: "agent-x" }) ?? [];
    const tool = tools.find(
      (candidate) => candidate.name === "expert_run_auto",
    );
    if (!tool) throw new Error("expert_run_auto tool was not registered");

    const result = await tool.execute("call-1", {
      task: "研究一个题材并生成报告",
    });
    expect(result.isError).toBeFalsy();

    const block = result.content[0].text
      .replace(/^```a2ui\n/, "")
      .replace(/\n```$/, "");
    const run = findComponents(parse(block))[0]?.run;
    // runId flows through; auto runs have no approval gate, so no workflowId.
    expect(run?.runId).toBe("run-9");
    expect(run).not.toHaveProperty("workflowId");
    expect(run?.steps).toEqual([
      {
        id: "search",
        name: "搜索",
        assigneeName: "搜索专家",
        cardId: "card-search",
        dependsOn: [],
      },
      {
        id: "analyze",
        name: "分析",
        assigneeName: "分析专家",
        cardId: "card-analyze",
        dependsOn: ["search"],
      },
      {
        id: "generate",
        name: "生成",
        assigneeName: "生成专家",
        cardId: "card-generate",
        dependsOn: ["analyze"],
      },
    ]);

    const summary = JSON.parse(result.content[1].text) as {
      subtaskCount?: number;
    };
    expect(summary.subtaskCount).toBe(3);
  });
});
