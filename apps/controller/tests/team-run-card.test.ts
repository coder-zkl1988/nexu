import { describe, expect, it } from "vitest";
// The nexu-team runtime plugin builds the A2UI run card. Import the real
// builder so this guards the exact payload the chat UI renders.
import { buildTeamRunCard } from "../static/runtime-plugins/nexu-team/index.js";

type A2UIMessage = {
  createSurface?: { surfaceId: string; catalogId?: string };
  updateComponents?: {
    surfaceId: string;
    components: Array<{
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
    }>;
  };
};

function parse(jsonl: string): A2UIMessage[] {
  return jsonl.split("\n").map((line) => JSON.parse(line));
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
    const component = messages.find((m) => m.updateComponents)?.updateComponents
      ?.components[0];
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
    const component = parse(autoJsonl).find((m) => m.updateComponents)
      ?.updateComponents?.components[0];
    expect(component?.run).not.toHaveProperty("runId");
    expect(component?.run).not.toHaveProperty("workflowId");
  });
});
