import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TeamResponse } from "@nexu/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TeamNotFoundError } from "../src/services/teams/team-service.js";
import { TeamWorkflowLedgerStore } from "../src/services/teams/team-workflow-ledger.js";
import {
  TeamWorkflowService,
  type TeamWorkflowServiceDeps,
  WorkflowInputError,
  WorkflowNotFoundError,
  WorkflowTemplateNotFoundError,
  WorkflowValidationError,
  renderTemplate,
  topologicalLevels,
  validateWorkflowDefinition,
} from "../src/services/teams/team-workflow-service.js";
import { TEAM_WORKFLOW_TEMPLATES } from "../src/services/teams/team-workflow-templates.js";

const TEAM: TeamResponse = {
  id: "team-1",
  name: "Docs Squad",
  leadBotId: "bot-lead",
  members: [
    { expertSlug: "researcher", botId: "bot-researcher", name: "Researcher" },
    { expertSlug: "writer", botId: "bot-writer", name: "Writer" },
  ],
  boardId: "team-team-1",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

const TWO_STEP_DEFINITION = {
  name: "Tech blog SOP",
  description: "research → write",
  inputs: [
    { name: "topic", description: "blog topic", required: true },
    { name: "audience", required: false, default: "developers" },
  ],
  steps: [
    {
      id: "research",
      type: "task" as const,
      assigneeSlug: "researcher",
      name: "Researcher",
      task: "Research {{topic}} for {{audience}}.",
      output: "research_brief",
      dependsOn: [],
    },
    {
      id: "write",
      type: "task" as const,
      assigneeSlug: "writer",
      task: "Write a post from:\n{{research_brief}}",
      output: "final_post",
      dependsOn: ["research"],
    },
  ],
};

describe("validateWorkflowDefinition", () => {
  function expectInvalid(
    mutate: (definition: typeof TWO_STEP_DEFINITION) => unknown,
    messagePart: string,
  ): void {
    const definition = structuredClone(TWO_STEP_DEFINITION);
    mutate(definition);
    expect(() => validateWorkflowDefinition(definition, TEAM)).toThrowError(
      expect.objectContaining({
        name: "WorkflowValidationError",
        message: expect.stringContaining(messagePart),
      }),
    );
  }

  it("accepts a well-formed DAG", () => {
    expect(() =>
      validateWorkflowDefinition(TWO_STEP_DEFINITION, TEAM),
    ).not.toThrow();
  });

  it("rejects duplicate step ids", () => {
    expectInvalid((d) => {
      // biome-ignore lint/style/noNonNullAssertion: fixture has two steps
      d.steps[1]!.id = "research";
    }, "duplicate step id");
  });

  it("rejects a dependsOn pointing at an unknown step", () => {
    expectInvalid((d) => {
      // biome-ignore lint/style/noNonNullAssertion: fixture has two steps
      d.steps[1]!.dependsOn = ["ghost"];
    }, "unknown step");
  });

  it("rejects self-dependencies", () => {
    expectInvalid((d) => {
      // biome-ignore lint/style/noNonNullAssertion: fixture has two steps
      d.steps[0]!.dependsOn = ["research"];
    }, "depends on itself");
  });

  it("rejects dependency cycles", () => {
    expectInvalid((d) => {
      // biome-ignore lint/style/noNonNullAssertion: fixture has two steps
      d.steps[0]!.dependsOn = ["write"];
    }, "cycle");
  });

  it("rejects assignees that are not team members", () => {
    expectInvalid((d) => {
      // biome-ignore lint/style/noNonNullAssertion: fixture has two steps
      d.steps[0]!.assigneeSlug = "stranger";
    }, "not a team member");
  });

  it("rejects an output name that collides with an input", () => {
    expectInvalid((d) => {
      // biome-ignore lint/style/noNonNullAssertion: fixture has two steps
      d.steps[0]!.output = "topic";
    }, "collides with an input");
  });

  it("rejects duplicate output names", () => {
    expectInvalid((d) => {
      // biome-ignore lint/style/noNonNullAssertion: fixture has two steps
      d.steps[1]!.output = "research_brief";
    }, "duplicate output");
  });

  it("rejects a {{var}} that no input or upstream output provides", () => {
    expectInvalid((d) => {
      // biome-ignore lint/style/noNonNullAssertion: fixture has two steps
      d.steps[1]!.task = "Write using {{missing_var}}";
    }, "{{missing_var}}");
  });

  it("rejects referencing a sibling output without declaring the dependency", () => {
    // `write` consumes research_brief but no longer depends on `research` —
    // the value would race. AO enforces the same rule.
    expectInvalid((d) => {
      // biome-ignore lint/style/noNonNullAssertion: fixture has two steps
      d.steps[1]!.dependsOn = [];
    }, "{{research_brief}}");
  });
});

describe("topologicalLevels", () => {
  it("groups independent steps into parallel waves", () => {
    const levels = topologicalLevels([
      { id: "a", assigneeSlug: "x", task: "t", dependsOn: [] },
      { id: "b", assigneeSlug: "x", task: "t", dependsOn: [] },
      { id: "c", assigneeSlug: "x", task: "t", dependsOn: ["a", "b"] },
    ]);
    expect(levels.map((wave) => wave.map((s) => s.id))).toEqual([
      ["a", "b"],
      ["c"],
    ]);
  });
});

describe("renderTemplate", () => {
  it("substitutes {{vars}} from context", () => {
    const context = new Map([["topic", "Rust"]]);
    expect(renderTemplate("Write about {{ topic }}!", context)).toBe(
      "Write about Rust!",
    );
  });

  it("throws on a variable with no value", () => {
    expect(() => renderTemplate("{{nope}}", new Map())).toThrowError(
      /\{\{nope\}\}/,
    );
  });
});

describe("TeamWorkflowService", () => {
  let tmpDir: string;
  let ledger: TeamWorkflowLedgerStore;
  let gateway: {
    workboardBoardUpsert: ReturnType<typeof vi.fn>;
    workboardCardCreate: ReturnType<typeof vi.fn>;
    workboardCardDecompose: ReturnType<typeof vi.fn>;
    workboardCardMove: ReturnType<typeof vi.fn>;
    workboardCardLinkDependency: ReturnType<typeof vi.fn>;
    workboardCardUpdate: ReturnType<typeof vi.fn>;
    workboardCardComment: ReturnType<typeof vi.fn>;
    workboardCardComplete: ReturnType<typeof vi.fn>;
    workboardCardBlock: ReturnType<typeof vi.fn>;
  };
  let sendChat: ReturnType<typeof vi.fn>;
  let readSessionEntry: ReturnType<typeof vi.fn>;
  let readAssistantReply: ReturnType<typeof vi.fn>;
  let ensureTeamMembers: ReturnType<typeof vi.fn>;
  let idCounter: number;

  function buildService(
    overrides: Partial<TeamWorkflowServiceDeps> = {},
  ): TeamWorkflowService {
    return new TeamWorkflowService(
      {
        workflows: ledger,
        getTeam: (teamId) => (teamId === TEAM.id ? TEAM : null),
        gateway,
        resolveExpertPersona: async (slug) => `persona of ${slug}`,
        sendChat,
        readSessionEntry,
        readAssistantReply,
        ensureTeamMembers,
        composeDraft: vi.fn(async () => ({
          draft: TWO_STEP_DEFINITION,
          warnings: [],
        })),
        genId: () => `id-${++idCounter}`,
        ...overrides,
      },
      { pollIntervalMs: 1, stepTimeoutMs: 500, emptyDoneTimeoutMs: 50 },
    );
  }

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "team-wf-svc-"));
    ledger = new TeamWorkflowLedgerStore(join(tmpDir, "wf-ledger.json"));
    idCounter = 0;
    let childCounter = 0;
    gateway = {
      workboardBoardUpsert: vi.fn(async () => ({})),
      workboardCardCreate: vi.fn(async () => ({
        card: { id: "card-parent", title: "p", status: "todo" },
      })),
      workboardCardDecompose: vi.fn(
        async (params: { children: Array<{ title: string }> }) => ({
          children: params.children.map((child) => ({
            id: `card-${++childCounter}`,
            title: child.title,
            status: "todo",
          })),
        }),
      ),
      workboardCardMove: vi.fn(async () => ({
        card: { id: "x", title: "x", status: "running" },
      })),
      workboardCardLinkDependency: vi.fn(async () => ({})),
      workboardCardUpdate: vi.fn(async () => ({
        card: { id: "x", title: "x", status: "todo" },
      })),
      workboardCardComment: vi.fn(async () => ({})),
      workboardCardComplete: vi.fn(async () => ({})),
      workboardCardBlock: vi.fn(async () => ({})),
    };
    sendChat = vi.fn(async () => ({ runId: "r", status: "started" }));
    // Lane completes immediately; the transcript path encodes the lane key so
    // per-step replies can be told apart.
    readSessionEntry = vi.fn(async (_botId: string, sessionKey: string) => ({
      status: "done",
      sessionFile: `/transcripts/${sessionKey}.jsonl`,
    }));
    readAssistantReply = vi.fn(async (sessionFile: string) =>
      sessionFile.includes("-research") ? "RESEARCH-BRIEF-42" : "FINAL-POST-OK",
    );
    ensureTeamMembers = vi.fn(async () => TEAM);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates, lists, gets, updates, and deletes workflows scoped to the team", async () => {
    const service = buildService();
    const created = await service.createWorkflow(TEAM.id, TWO_STEP_DEFINITION);
    expect(created.id).toBe("id-1");
    expect(service.listWorkflows(TEAM.id)).toHaveLength(1);
    expect(service.getWorkflow(TEAM.id, created.id).name).toBe("Tech blog SOP");

    const updated = await service.updateWorkflow(TEAM.id, created.id, {
      name: "Renamed SOP",
    });
    expect(updated.name).toBe("Renamed SOP");

    expect(await service.deleteWorkflow(TEAM.id, created.id)).toBe(true);
    expect(service.listWorkflows(TEAM.id)).toHaveLength(0);
  });

  it("rejects operations for unknown teams and foreign workflows", async () => {
    const service = buildService();
    expect(() => service.listWorkflows("ghost-team")).toThrow(
      TeamNotFoundError,
    );
    await expect(
      service.createWorkflow("ghost-team", TWO_STEP_DEFINITION),
    ).rejects.toBeInstanceOf(TeamNotFoundError);
    expect(() => service.getWorkflow(TEAM.id, "nope")).toThrow(
      WorkflowNotFoundError,
    );
  });

  it("rejects invalid definitions at create time", async () => {
    const service = buildService();
    const bad = structuredClone(TWO_STEP_DEFINITION);
    // biome-ignore lint/style/noNonNullAssertion: fixture has two steps
    bad.steps[1]!.dependsOn = ["ghost"];
    await expect(service.createWorkflow(TEAM.id, bad)).rejects.toBeInstanceOf(
      WorkflowValidationError,
    );
  });

  it("rejects runs with missing required or unknown inputs", async () => {
    const service = buildService();
    const workflow = await service.createWorkflow(TEAM.id, TWO_STEP_DEFINITION);
    await expect(
      service.runWorkflow(TEAM.id, workflow.id, { inputs: {} }),
    ).rejects.toBeInstanceOf(WorkflowInputError);
    await expect(
      service.runWorkflow(TEAM.id, workflow.id, {
        inputs: { topic: "Rust", bogus: "x" },
      }),
    ).rejects.toBeInstanceOf(WorkflowInputError);
  });

  it("materializes the run and executes steps in order, threading outputs downstream", async () => {
    const service = buildService();
    const workflow = await service.createWorkflow(TEAM.id, TWO_STEP_DEFINITION);

    const result = await service.runWorkflow(TEAM.id, workflow.id, {
      inputs: { topic: "Rust async" },
    });

    expect(result.boardId).toBe(TEAM.boardId);
    expect(result.parentCardId).toBe("card-parent");
    expect(result.cards).toEqual([
      { stepId: "research", cardId: "card-1" },
      { stepId: "write", cardId: "card-2" },
    ]);
    // write depends on research → one sibling dependency link.
    expect(gateway.workboardCardLinkDependency).toHaveBeenCalledWith({
      parentId: "card-1",
      childId: "card-2",
    });

    // Background run: wait until the parent card completes.
    await vi.waitFor(() => {
      expect(gateway.workboardCardComplete).toHaveBeenCalledWith(
        expect.objectContaining({ id: "card-parent" }),
      );
    });

    // Step 1 got the rendered inputs (default audience included).
    const researchSend = sendChat.mock.calls.find(([input]) =>
      (input as { sessionKey: string }).sessionKey.includes("-research"),
    )?.[0] as { botId: string; message: string };
    expect(researchSend.botId).toBe("bot-researcher");
    expect(researchSend.message).toContain("Research Rust async");
    expect(researchSend.message).toContain("developers");
    expect(researchSend.message).toContain("persona of researcher");

    // Step 2 received step 1's reply through {{research_brief}}.
    const writeSend = sendChat.mock.calls.find(([input]) =>
      (input as { sessionKey: string }).sessionKey.includes("-write"),
    )?.[0] as { botId: string; message: string };
    expect(writeSend.botId).toBe("bot-writer");
    expect(writeSend.message).toContain("RESEARCH-BRIEF-42");

    // Replies are recorded on the cards and both steps completed.
    expect(gateway.workboardCardComment).toHaveBeenCalledWith({
      id: "card-1",
      body: "RESEARCH-BRIEF-42",
    });
    expect(gateway.workboardCardComment).toHaveBeenCalledWith({
      id: "card-2",
      body: "FINAL-POST-OK",
    });
    expect(gateway.workboardCardComplete).toHaveBeenCalledWith({
      id: "card-1",
      summary: "Researcher done",
    });
    expect(gateway.workboardCardBlock).not.toHaveBeenCalled();
  });

  it("blocks the failing step, remaining cards, and the parent when a step fails", async () => {
    readSessionEntry.mockImplementation(
      async (_botId: string, sessionKey: string) =>
        sessionKey.includes("-research")
          ? { status: "failed" }
          : { status: "done", sessionFile: "/t.jsonl" },
    );
    const service = buildService();
    const workflow = await service.createWorkflow(TEAM.id, TWO_STEP_DEFINITION);

    await service.runWorkflow(TEAM.id, workflow.id, {
      inputs: { topic: "Rust" },
    });

    await vi.waitFor(() => {
      expect(gateway.workboardCardBlock).toHaveBeenCalledWith(
        expect.objectContaining({ id: "card-parent" }),
      );
    });
    // The downstream step never ran and is blocked with the upstream reason.
    expect(gateway.workboardCardBlock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "card-2",
        reason: expect.stringContaining("research"),
      }),
    );
    const writeSends = sendChat.mock.calls.filter(([input]) =>
      (input as { sessionKey: string }).sessionKey.includes("-write"),
    );
    expect(writeSends).toHaveLength(0);
    expect(gateway.workboardCardComplete).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: "card-parent" }),
    );
  });

  it("ships templates that self-validate against their own required experts", () => {
    expect(TEAM_WORKFLOW_TEMPLATES.length).toBeGreaterThanOrEqual(3);
    for (const template of TEAM_WORKFLOW_TEMPLATES) {
      const assignees = new Set(
        template.steps.map((step) => step.assigneeSlug),
      );
      // requiredExperts must cover every step assignee, or instantiation
      // could produce a workflow that fails membership validation.
      for (const slug of assignees) {
        expect(template.requiredExperts).toContain(slug);
      }
      const syntheticTeam = {
        members: template.requiredExperts.map((slug) => ({
          expertSlug: slug,
          botId: `bot-${slug}`,
        })),
      };
      expect(() =>
        validateWorkflowDefinition(template, syntheticTeam),
      ).not.toThrow();
    }
  });

  it("instantiates a template as a builtin workflow after ensuring members", async () => {
    const template = TEAM_WORKFLOW_TEMPLATES[0];
    if (!template) {
      throw new Error("shipped templates must not be empty");
    }
    const teamWithExperts: TeamResponse = {
      ...TEAM,
      members: template.requiredExperts.map((slug) => ({
        expertSlug: slug,
        botId: `bot-${slug}`,
      })),
    };
    ensureTeamMembers.mockResolvedValue(teamWithExperts);
    const service = buildService();

    const workflow = await service.instantiateTemplate(TEAM.id, template.id);

    expect(ensureTeamMembers).toHaveBeenCalledWith(
      TEAM.id,
      template.requiredExperts,
    );
    expect(workflow.source).toBe("builtin");
    expect(workflow.name).toBe(template.name);
    expect(service.listWorkflows(TEAM.id)).toHaveLength(1);
  });

  it("rejects instantiating an unknown template", async () => {
    const service = buildService();
    await expect(
      service.instantiateTemplate(TEAM.id, "ghost-template"),
    ).rejects.toBeInstanceOf(WorkflowTemplateNotFoundError);
  });

  it("pauses a run at an approval step and resumes when approved", async () => {
    const service = buildService();
    const workflow = await service.createWorkflow(TEAM.id, {
      name: "Gated SOP",
      inputs: [{ name: "topic", required: true }],
      steps: [
        {
          id: "research",
          type: "task" as const,
          assigneeSlug: "researcher",
          task: "Research {{topic}}.",
          output: "research_brief",
          dependsOn: [],
        },
        {
          id: "gate",
          type: "approval" as const,
          assigneeSlug: "writer",
          task: "请确认调研结论可用：{{research_brief}}",
          dependsOn: ["research"],
        },
        {
          id: "write",
          type: "task" as const,
          assigneeSlug: "writer",
          task: "Write from {{research_brief}}.",
          output: "final_post",
          dependsOn: ["gate"],
        },
      ],
    });

    const run = await service.runWorkflow(TEAM.id, workflow.id, {
      inputs: { topic: "Rust" },
    });

    // The run reaches the gate and pauses: card blocked, approval listed.
    await vi.waitFor(() => {
      expect(service.listPendingApprovals(TEAM.id)).toHaveLength(1);
    });
    const pending = service.listPendingApprovals(TEAM.id)[0];
    expect(pending?.runId).toBe(run.runId);
    expect(pending?.stepId).toBe("gate");
    // The prompt carries the rendered upstream output.
    expect(pending?.prompt).toContain("RESEARCH-BRIEF-42");
    expect(gateway.workboardCardBlock).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "awaiting approval" }),
    );
    // Downstream step has not started.
    expect(
      sendChat.mock.calls.filter(([input]) =>
        (input as { sessionKey: string }).sessionKey.includes("-write"),
      ),
    ).toHaveLength(0);

    await service.approveStep(TEAM.id, workflow.id, run.runId, "gate");

    // The run resumes past the gate and completes.
    await vi.waitFor(() => {
      expect(gateway.workboardCardComplete).toHaveBeenCalledWith(
        expect.objectContaining({ id: "card-parent" }),
      );
    });
    expect(service.listPendingApprovals(TEAM.id)).toHaveLength(0);
    expect(
      sendChat.mock.calls.filter(([input]) =>
        (input as { sessionKey: string }).sessionKey.includes("-write"),
      ),
    ).toHaveLength(1);
  });

  it("rejects approving a step that is not pending", async () => {
    const service = buildService();
    await expect(
      service.approveStep(TEAM.id, "wf-x", "run-x", "step-x"),
    ).rejects.toMatchObject({ name: "WorkflowApprovalNotFoundError" });
  });
});
