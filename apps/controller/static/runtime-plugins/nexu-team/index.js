// nexu-team runtime plugin: chat-first team operations for team LEAD agents.
//   - team_run_auto(task): the lead decomposes + dispatches via the
//     controller's structured board engine (NOT sessions_spawn), and the chat
//     shows a live TeamRunCard.
//   - team_list_workflows(): list the lead's team SOP workflows.
//   - team_run_workflow(workflowId, inputs): run a saved SOP; the chat shows
//     the run card with the real step DAG.
// Progress/approvals/export never round-trip through the model: the card
// polls the controller directly. See
// specs/design-docs/2026-07-02-chat-first-team-operations.md.

const TEAMS_PATH = "/api/v1/teams";
const CACHE_TTL_MS = 30_000;

/** @type {{ ts: number, teams: Array<object> } | null} */
let teamsCache = null;
/** Controller base URL, injected via plugin config by the compiler. */
let configuredControllerUrl = null;

function controllerOrigin() {
  const raw =
    configuredControllerUrl ||
    process.env.WEB_API_ORIGIN ||
    process.env.NEXU_CONTROLLER_URL ||
    process.env.CONTROLLER_URL ||
    "";
  return raw.replace(/\/+$/, "");
}

function jsonResult(value, isError) {
  const result = { content: [{ type: "text", text: JSON.stringify(value) }] };
  if (isError) {
    result.isError = true;
  }
  return result;
}

async function fetchTeams() {
  if (teamsCache && Date.now() - teamsCache.ts < CACHE_TTL_MS) {
    return teamsCache.teams;
  }
  const origin = controllerOrigin();
  if (!origin) {
    return teamsCache?.teams ?? [];
  }
  try {
    const res = await fetch(`${origin}${TEAMS_PATH}`);
    if (!res.ok) {
      return teamsCache?.teams ?? [];
    }
    const data = await res.json();
    teamsCache = {
      ts: Date.now(),
      teams: Array.isArray(data.teams) ? data.teams : [],
    };
    return teamsCache.teams;
  } catch {
    return teamsCache?.teams ?? [];
  }
}

/** Resolve the team this agent leads, or null (tools are lead-only). */
async function teamForLead(agentId) {
  if (!agentId) {
    return null;
  }
  const teams = await fetchTeams();
  return teams.find((team) => team.leadBotId === agentId) ?? null;
}

const NOT_A_LEAD = {
  error:
    "not_a_team_lead: this tool only works for a team lead agent. Answer the user yourself or use sessions_spawn.",
};

async function controllerPost(path, body) {
  const origin = controllerOrigin();
  if (!origin) {
    return { ok: false, error: "controller unavailable" };
  }
  try {
    const res = await fetch(`${origin}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const detail =
        data && typeof data.message === "string" ? data.message : "";
      return { ok: false, error: `request failed (${res.status}) ${detail}` };
    }
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

async function controllerGet(path) {
  const origin = controllerOrigin();
  if (!origin) {
    return { ok: false, error: "controller unavailable" };
  }
  try {
    const res = await fetch(`${origin}${path}`);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      return { ok: false, error: `request failed (${res.status})` };
    }
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

// Catalog hosting Nexu's custom A2UI components (registered in the web app at
// apps/web/src/lib/a2ui/index.ts).
const NEXU_A2UI_CATALOG = "https://nexu.app/a2ui/custom-catalog.json";

/** Build A2UI JSONL: a single createSurface with inline components (v1.0 form). */
function generateA2UIJSONL(surfaceId, components, catalogId) {
  const createSurface = catalogId
    ? { surfaceId, catalogId, components }
    : { surfaceId, components };
  return JSON.stringify({ version: "v0.9", createSurface });
}

/**
 * The in-chat run snapshot card. The TeamRunCard web component polls the
 * board itself (step lighting, approvals, final outputs, export) — this JSONL
 * only carries the static run identity + step skeleton.
 *
 * run: {
 *   teamId, boardId, parentCardId, title,
 *   runId?, workflowId?,                      // workflow runs only
 *   steps: [{ id, name, assigneeName, cardId, dependsOn: string[], type? }],
 * }
 */
export function buildTeamRunCard(run) {
  const surfaceId = `team-run-${run.parentCardId}`;
  const components = [
    {
      id: "team-run-card",
      type: "TeamRunCard",
      run: {
        teamId: String(run.teamId || ""),
        boardId: String(run.boardId || ""),
        parentCardId: String(run.parentCardId || ""),
        title: String(run.title || ""),
        ...(run.runId ? { runId: String(run.runId) } : {}),
        ...(run.workflowId ? { workflowId: String(run.workflowId) } : {}),
        steps: (Array.isArray(run.steps) ? run.steps : []).map((step) => ({
          id: String(step.id || ""),
          name: String(step.name || step.id || ""),
          assigneeName: String(step.assigneeName || ""),
          cardId: String(step.cardId || ""),
          dependsOn: Array.isArray(step.dependsOn)
            ? step.dependsOn.map(String)
            : [],
          ...(step.type ? { type: String(step.type) } : {}),
        })),
      },
    },
  ];
  return generateA2UIJSONL(surfaceId, components, NEXU_A2UI_CATALOG);
}

/** Tool result = run card A2UI + a short instruction the model can follow. */
function runCardResult(run, summaryForModel) {
  return {
    content: [
      { type: "text", text: ["```a2ui", buildTeamRunCard(run), "```"].join("\n") },
      {
        type: "text",
        text: JSON.stringify({
          started: true,
          ...summaryForModel,
          note: "The live run card is already shown to the user (progress, approvals and outputs update automatically). Reply with ONE short confirmation sentence. Do NOT repeat the plan, steps or assignees, and do NOT call sessions_spawn for this task.",
        }),
      },
    ],
  };
}

const RUN_AUTO_DESCRIPTION = `Dispatch a collaborative task to YOUR TEAM via the structured team board (auto-decomposition). TEAM-LEAD ONLY.

WHEN TO USE (you are a team lead):
- The user gives a task that benefits from one or more team members doing real work (content production, analysis, multi-part deliverables).
- Prefer this over sessions_spawn for team tasks: it tracks progress on the team board and shows the user a live run card.
DO NOT use for greetings, small talk, or questions you can answer directly.

RESULT: the run starts in the background and a live run card is rendered for the user automatically. Reply with one short confirmation only.`;

const LIST_WORKFLOWS_DESCRIPTION = `List YOUR TEAM's saved SOP workflows (id, name, description, required inputs). TEAM-LEAD ONLY. Call this when the user asks what workflows/SOPs exist, or before team_run_workflow when you need the workflowId or its input names.`;

const RUN_WORKFLOW_DESCRIPTION = `Run one of YOUR TEAM's saved SOP workflows by id. TEAM-LEAD ONLY.

- Get the workflowId and its declared inputs from team_list_workflows first (or from the conversation).
- Pass every required input in \`inputs\` (ask the user if a required value is missing).
RESULT: the run starts in the background and a live run card (with the step DAG) is rendered for the user automatically. Reply with one short confirmation only.`;

const EXPERT_RUN_AUTO_DESCRIPTION = `Dispatch a task to domain experts pulled automatically from the Nexu expert catalog — WITHOUT the user creating a team first. The controller plans the subtasks, auto-installs and enrolls the right experts into the system default team, and tracks progress on its board.

WHEN TO USE:
- The user's request needs one or more specialists to PRODUCE actual work (content, analysis, multi-part deliverables) and you lead no team.
- Prefer find_expert + sessions_spawn instead for a quick single-expert Q&A that needs no tracked deliverable.
- Answer simple, general, or conversational questions yourself — do NOT dispatch those.
- If you ARE a team lead, use team_run_auto instead.

RESULT: the run starts in the background and a live run card is rendered for the user automatically. Reply with ONE short confirmation sentence — do not repeat the plan.`;

const plugin = {
  id: "nexu-team",
  name: "Nexu Team Operations",
  description:
    "Registers team_run_auto / team_list_workflows / team_run_workflow so a team lead drives the structured team engine from chat.",
  register(api) {
    const cfg = api && api.pluginConfig;
    if (cfg && typeof cfg.controllerUrl === "string" && cfg.controllerUrl) {
      configuredControllerUrl = cfg.controllerUrl;
    }

    // Factory form: ctx carries the calling agent's id, which scopes every
    // tool to "the team this agent leads". NOTE: factory registrations MUST
    // pass opts.names (matching manifest contracts.tools) — without it the
    // registry records zero tool names and no agent ever sees the tools.
    const registerTeamTools = (ctx) => {
      const agentId = ctx && ctx.agentId ? String(ctx.agentId) : "";
      return [
        {
          name: "team_run_auto",
          label: "Run Team Task",
          description: RUN_AUTO_DESCRIPTION,
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
              task: {
                type: "string",
                description:
                  "The user's task, restated with any context the members need.",
              },
              maxSubtasks: {
                type: "number",
                description: "Optional cap on the number of subtasks.",
              },
            },
            required: ["task"],
          },
          async execute(_toolCallId, params) {
            const team = await teamForLead(agentId);
            if (!team) {
              return jsonResult(NOT_A_LEAD, true);
            }
            const body = { task: String(params?.task || "") };
            if (typeof params?.maxSubtasks === "number") {
              body.maxSubtasks = params.maxSubtasks;
            }
            const res = await controllerPost(
              `${TEAMS_PATH}/${team.id}/run-auto`,
              body,
            );
            if (!res.ok) {
              return jsonResult({ error: res.error }, true);
            }
            const { boardId, parentCardId, started, plan } = res.data;
            const nameBySlug = new Map(
              (team.members || []).map((m) => [m.expertSlug, m.name]),
            );
            // dispatchSubtasks preserves plan order, so started[i] is plan[i]'s card.
            const steps = (Array.isArray(plan) ? plan : []).map(
              (subtask, index) => ({
                id: started?.[index]?.cardId || `step-${index}`,
                name: subtask.title,
                assigneeName:
                  nameBySlug.get(subtask.assigneeSlug) || subtask.assigneeSlug,
                cardId: started?.[index]?.cardId || "",
                dependsOn: [],
              }),
            );
            return runCardResult(
              {
                teamId: team.id,
                boardId,
                parentCardId,
                title: body.task,
                steps,
              },
              { subtaskCount: steps.length },
            );
          },
        },
        {
          name: "team_list_workflows",
          label: "List Team Workflows",
          description: LIST_WORKFLOWS_DESCRIPTION,
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: {},
          },
          async execute() {
            const team = await teamForLead(agentId);
            if (!team) {
              return jsonResult(NOT_A_LEAD, true);
            }
            const res = await controllerGet(
              `${TEAMS_PATH}/${team.id}/workflows`,
            );
            if (!res.ok) {
              return jsonResult({ error: res.error }, true);
            }
            const workflows = (res.data?.workflows ?? []).map((workflow) => ({
              workflowId: workflow.id,
              name: workflow.name,
              description: workflow.description || "",
              stepCount: Array.isArray(workflow.steps)
                ? workflow.steps.length
                : 0,
              inputs: (workflow.inputs ?? []).map((input) => ({
                name: input.name,
                description: input.description || "",
                required: input.required === true,
                hasDefault: input.default !== undefined,
              })),
            }));
            return jsonResult({ workflows });
          },
        },
        {
          name: "team_run_workflow",
          label: "Run Team Workflow",
          description: RUN_WORKFLOW_DESCRIPTION,
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
              workflowId: { type: "string" },
              inputs: {
                type: "object",
                description:
                  "Values for the workflow's declared inputs (string values).",
                additionalProperties: { type: "string" },
              },
            },
            required: ["workflowId"],
          },
          async execute(_toolCallId, params) {
            const team = await teamForLead(agentId);
            if (!team) {
              return jsonResult(NOT_A_LEAD, true);
            }
            const workflowId = String(params?.workflowId || "");
            const listRes = await controllerGet(
              `${TEAMS_PATH}/${team.id}/workflows`,
            );
            if (!listRes.ok) {
              return jsonResult({ error: listRes.error }, true);
            }
            const workflow = (listRes.data?.workflows ?? []).find(
              (candidate) => candidate.id === workflowId,
            );
            if (!workflow) {
              return jsonResult(
                {
                  error: `workflow not found: ${workflowId}. Call team_list_workflows for valid ids.`,
                },
                true,
              );
            }
            const res = await controllerPost(
              `${TEAMS_PATH}/${team.id}/workflows/${workflowId}/run`,
              { inputs: params?.inputs ?? {} },
            );
            if (!res.ok) {
              return jsonResult({ error: res.error }, true);
            }
            const { runId, boardId, parentCardId, cards } = res.data;
            const cardByStep = new Map(
              (cards ?? []).map((card) => [card.stepId, card.cardId]),
            );
            const nameBySlug = new Map(
              (team.members || []).map((m) => [m.expertSlug, m.name]),
            );
            const steps = (workflow.steps ?? []).map((step) => ({
              id: step.id,
              name: step.name || step.id,
              assigneeName:
                nameBySlug.get(step.assigneeSlug) || step.assigneeSlug,
              cardId: cardByStep.get(step.id) || "",
              dependsOn: step.dependsOn ?? [],
              ...(step.type && step.type !== "task"
                ? { type: step.type }
                : {}),
            }));
            return runCardResult(
              {
                teamId: team.id,
                boardId,
                parentCardId,
                runId,
                workflowId,
                title: workflow.name,
                steps,
              },
              { workflow: workflow.name, stepCount: steps.length },
            );
          },
        },
        {
          name: "expert_run_auto",
          label: "Run Experts",
          description: EXPERT_RUN_AUTO_DESCRIPTION,
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
              task: {
                type: "string",
                description:
                  "The user's task, restated with any context the experts need.",
              },
              maxSubtasks: {
                type: "number",
                description: "Optional cap on the number of subtasks.",
              },
            },
            required: ["task"],
          },
          async execute(_toolCallId, params) {
            const leadTeam = await teamForLead(agentId);
            if (leadTeam) {
              return jsonResult(
                {
                  error:
                    "you lead a team — use team_run_auto so the run lands on your own team's board.",
                },
                true,
              );
            }
            const body = { task: String(params?.task || "") };
            if (typeof params?.maxSubtasks === "number") {
              body.maxSubtasks = params.maxSubtasks;
            }
            const res = await controllerPost(
              `${TEAMS_PATH}/default/run-auto`,
              body,
            );
            if (!res.ok) {
              return jsonResult({ error: res.error }, true);
            }
            const { teamId, runId, boardId, parentCardId, cards, steps: composed } =
              res.data;
            teamsCache = null; // the default team may have just been created
            // Resolve member display names for the card.
            const teamRes = await controllerGet(`${TEAMS_PATH}/${teamId}`);
            const nameBySlug = new Map(
              ((teamRes.ok && teamRes.data?.members) || []).map((m) => [
                m.expertSlug,
                m.name,
              ]),
            );
            const cardByStep = new Map(
              (cards ?? []).map((card) => [card.stepId, card.cardId]),
            );
            // T3 returns the composed DAG (steps carry real dependsOn); map each
            // step to its board card and preserve the dependency edges.
            const steps = (Array.isArray(composed) ? composed : []).map(
              (step) => ({
                id: String(step.id || ""),
                name: String(step.name || step.id || ""),
                assigneeName:
                  nameBySlug.get(step.assigneeSlug) || step.assigneeSlug,
                cardId: cardByStep.get(step.id) || "",
                dependsOn: Array.isArray(step.dependsOn)
                  ? step.dependsOn.map(String)
                  : [],
              }),
            );
            return runCardResult(
              {
                teamId,
                runId,
                boardId,
                parentCardId,
                title: body.task,
                steps,
              },
              { subtaskCount: steps.length },
            );
          },
        },
      ];
    };
    api.registerTool(registerTeamTools, {
      names: [
        "team_run_auto",
        "team_list_workflows",
        "team_run_workflow",
        "expert_run_auto",
      ],
    });
  },
};

export default plugin;
