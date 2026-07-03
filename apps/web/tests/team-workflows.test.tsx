import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TeamWorkflows } from "../src/components/teams/team-workflows";
import {
  WorkflowDagCanvas,
  topologicalWaves,
} from "../src/components/teams/workflow-dag-canvas";
import { A2UISidebarProvider } from "../src/lib/a2ui/a2ui-sidebar-context";
import { TeamRunCard } from "../src/lib/a2ui/custom-components/TeamRunCard";
import {
  type TeamRunInfo,
  TeamRunPanel,
} from "../src/lib/a2ui/custom-components/TeamRunPanel";
import type { CustomComponentProps } from "../src/lib/a2ui/custom-components/registry";
import {
  __resetCanvasForTests,
  getCanvasState,
} from "../src/lib/canvas/canvas-store";
import { pinTeamRunToCanvas } from "../src/lib/canvas/team-step-node";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
  }),
}));

vi.mock("../lib/api/sdk.gen", () => ({}));

// The vitest environment here is plain Node — no browser `localStorage`.
// Components degrade gracefully without it; this minimal in-memory polyfill
// lets the persistence paths actually be exercised.
if (typeof globalThis.localStorage === "undefined") {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

const TEAM = {
  id: "team-1",
  name: "Docs Squad",
  leadBotId: "bot-lead",
  members: [{ expertSlug: "researcher", botId: "bot-r", name: "Researcher" }],
  boardId: "team-team-1",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

const STEPS = [
  { id: "a", assigneeSlug: "researcher", task: "t", dependsOn: [] },
  { id: "b", assigneeSlug: "researcher", task: "t", dependsOn: [] },
  {
    id: "c",
    name: "整合",
    assigneeSlug: "researcher",
    task: "t",
    dependsOn: ["a", "b"],
  },
];

const RUN: TeamRunInfo = {
  teamId: TEAM.id,
  boardId: TEAM.boardId,
  parentCardId: "parent-1",
  runId: "run-1",
  workflowId: "wf-1",
  title: "小红书爆款笔记",
  steps: [
    {
      id: "a",
      name: "初稿",
      assigneeName: "Researcher",
      cardId: "card-a",
      dependsOn: [],
    },
    {
      id: "b",
      name: "审核",
      assigneeName: "Researcher",
      cardId: "card-b",
      dependsOn: ["a"],
      type: "approval",
    },
  ],
};

function customProps(run: TeamRunInfo): CustomComponentProps {
  return {
    comp: { id: "x", type: "TeamRunCard", run } as never,
    resolve: (value) => value,
    surface: {} as never,
    manager: {} as never,
  };
}

function queryClientWithRunData() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(["teams", TEAM.id, "board"], {
    boardId: TEAM.boardId,
    cards: [
      {
        id: "card-a",
        title: "初稿",
        status: "done",
        agentId: null,
        assigneeName: null,
        output: "DELIVERABLE-A",
      },
      {
        id: "card-b",
        title: "审核",
        status: "running",
        agentId: null,
        assigneeName: null,
        output: null,
      },
    ],
  });
  queryClient.setQueryData(["teams", TEAM.id, "workflow-approvals"], {
    approvals: [
      {
        teamId: TEAM.id,
        workflowId: "wf-1",
        runId: "run-1",
        stepId: "b",
        cardId: "card-b",
        prompt: "请审核初稿是否可发布",
      },
    ],
  });
  return queryClient;
}

describe("WorkflowDagCanvas", () => {
  it("lays steps out in topological waves", () => {
    const waves = topologicalWaves(STEPS);
    expect(waves.map((wave) => wave.map((s) => s.id))).toEqual([
      ["a", "b"],
      ["c"],
    ]);
  });

  it("renders a node per step, edges per dependency, and status lighting", () => {
    const markup = renderToStaticMarkup(
      <WorkflowDagCanvas
        steps={STEPS}
        statusByStepId={{ a: "done", b: "running" }}
      />,
    );
    expect(markup).toContain('data-dag-node="a"');
    expect(markup).toContain('data-dag-node="b"');
    expect(markup).toContain('data-dag-node="c"');
    expect(markup).toContain('data-dag-status="done"');
    expect(markup).toContain('data-dag-status="running"');
    expect(markup).toContain('data-dag-status="pending"');
    // Two dependency edges into c.
    expect(markup.match(/<path /g)).toHaveLength(2);
    expect(markup).toContain("整合");
  });

  it("marks approval steps distinctly", () => {
    const markup = renderToStaticMarkup(
      <WorkflowDagCanvas
        steps={[
          {
            id: "gate",
            type: "approval",
            assigneeSlug: "researcher",
            task: "confirm",
            dependsOn: [],
          },
        ]}
      />,
    );
    expect(markup).toContain("approval");
  });
});

describe("TeamWorkflows", () => {
  it("renders the workflow list from the query cache", () => {
    localStorage.clear();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(["teams", TEAM.id, "workflows"], {
      workflows: [
        {
          id: "wf-1",
          teamId: TEAM.id,
          name: "小红书爆款笔记",
          description: "主题 → 成稿",
          inputs: [],
          steps: STEPS,
          source: "builtin",
          createdAt: "2026-07-01T00:00:00.000Z",
          updatedAt: "2026-07-01T00:00:00.000Z",
        },
      ],
    });

    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <A2UISidebarProvider>
          <TeamWorkflows team={TEAM} />
        </A2UISidebarProvider>
      </QueryClientProvider>,
    );

    expect(markup).toContain('data-team-workflows="true"');
    expect(markup).toContain('data-workflow-row="wf-1"');
    expect(markup).toContain("小红书爆款笔记");
    expect(markup).toContain("teamWorkflows.builtin");
    expect(markup).toContain('data-workflow-run="wf-1"');
    // No stored run — no reopen button.
    expect(markup).not.toContain("data-recent-run");
  });

  it("offers to reopen the most recent run from localStorage (survives remount)", () => {
    localStorage.clear();
    localStorage.setItem(
      `nexu:team-workflows:recent-run:${TEAM.id}`,
      JSON.stringify(RUN),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(["teams", TEAM.id, "workflows"], {
      workflows: [],
    });

    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <A2UISidebarProvider>
          <TeamWorkflows team={TEAM} />
        </A2UISidebarProvider>
      </QueryClientProvider>,
    );

    expect(markup).toContain('data-recent-run="parent-1"');
    localStorage.clear();
  });
});

describe("pinTeamRunToCanvas", () => {
  it("expands a run into per-step nodes with dependency connections, idempotently", () => {
    __resetCanvasForTests();
    pinTeamRunToCanvas(RUN);
    pinTeamRunToCanvas(RUN); // reopening must not duplicate

    const state = getCanvasState();
    expect(state.nodes.map((n) => n.id).sort()).toEqual([
      "step-card-a",
      "step-card-b",
    ]);
    expect(state.nodes.every((n) => n.type === "team-step")).toBe(true);
    // b dependsOn a → one connection a→b.
    expect(state.connections).toHaveLength(1);
    expect(state.connections[0]).toMatchObject({
      fromNodeId: "step-card-a",
      toNodeId: "step-card-b",
    });
    // Approval flag survives into node metadata.
    const gate = state.nodes.find((n) => n.id === "step-card-b");
    expect(gate?.metadata.step?.isApproval).toBe(true);
    // Downstream wave sits to the right of its upstream.
    const a = state.nodes.find((n) => n.id === "step-card-a");
    expect((gate?.position.x ?? 0) > (a?.position.x ?? 0)).toBe(true);
    expect(state.panelOpen).toBe(true);
  });
});

describe("TeamRunCard", () => {
  it("lights steps from the board and surfaces pending approvals inline", () => {
    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClientWithRunData()}>
        <A2UISidebarProvider>
          <TeamRunCard {...customProps(RUN)} />
        </A2UISidebarProvider>
      </QueryClientProvider>,
    );

    expect(markup).toContain('data-team-run-card="parent-1"');
    expect(markup).toContain('data-run-step-status="done"');
    expect(markup).toContain('data-run-step-status="running"');
    // The pending approval for this run renders an inline approve button.
    expect(markup).toContain("请审核初稿是否可发布");
    expect(markup).toContain("批准");
    // Still running — no export affordance yet.
    expect(markup).not.toContain("导出 Markdown");
  });
});

describe("TeamRunPanel", () => {
  it("renders the DAG with live status and the approval banner", () => {
    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClientWithRunData()}>
        <TeamRunPanel {...customProps(RUN)} />
      </QueryClientProvider>,
    );

    expect(markup).toContain('data-team-run-panel="parent-1"');
    expect(markup).toContain('data-dag-node="a"');
    expect(markup).toContain('data-dag-status="done"');
    expect(markup).toContain('data-dag-status="running"');
    expect(markup).toContain("等待人工审批");
  });
});
