import type { TeamSubtaskInput } from "@nexu/shared";
import { logger } from "../../lib/logger.js";

export type TeamPlannerMember = {
  slug: string;
  name: string;
  description: string;
};

export type TeamPlannerDeps = {
  /** Gateway HTTP base, e.g. http://127.0.0.1:18789 (OpenAI-compatible). */
  gatewayBaseUrl: string;
  gatewayToken: string | null;
  fetchImpl?: typeof globalThis.fetch;
};

/** A planning agent turn should be quick; abort if the gateway wedges. */
const PLAN_TIMEOUT_MS = 60_000;

const PLAN_INSTRUCTIONS = [
  "You are the orchestrator of a team of expert AI agents.",
  "Given a task and the team roster, break the task into focused subtasks,",
  "each assigned to exactly one member who is best suited for it.",
  "",
  "Rules:",
  "- Output ONLY a JSON array. No prose, no markdown code fences.",
  '- Each element: {"title": string, "assigneeSlug": string, "notes": string}.',
  "- `assigneeSlug` MUST be one of the provided member slugs. Never invent one.",
  "- Prefer one subtask per relevant member; skip members that do not fit.",
  "- `title` is a short imperative; `notes` adds concrete detail for that member.",
].join("\n");

/**
 * Produces an agentic task decomposition by calling the gateway's
 * OpenAI-compatible chat-completions endpoint AS the lead agent
 * (`model: openclaw/<agentId>` — the endpoint runs a full agent turn and
 * rejects raw model refs with 400; verified live 2026-07-02). The controller
 * stays in charge of the deterministic board ops (and persona injection);
 * only the WHO/WHAT decision is delegated to the model.
 */
export class TeamPlanner {
  constructor(private readonly deps: TeamPlannerDeps) {}

  async planSubtasks(args: {
    task: string;
    members: readonly TeamPlannerMember[];
    /** Lead bot id — the agent that runs the planning turn with its own model. */
    agentId: string;
    maxSubtasks?: number;
  }): Promise<TeamSubtaskInput[]> {
    const limit = args.maxSubtasks ?? Math.min(args.members.length, 6);
    const roster = args.members
      .map(
        (m) =>
          `- slug: ${m.slug} | name: ${m.name} | specialty: ${m.description || "(no description)"}`,
      )
      .join("\n");
    // Agent turns dilute `system` messages with the agent's own persona, so
    // the instructions ride in the user message (same finding as the
    // workflow composer).
    const userPrompt = [
      PLAN_INSTRUCTIONS,
      "",
      "Team members:",
      roster,
      "",
      "Task:",
      args.task,
      "",
      `Return at most ${limit} subtasks as a JSON array.`,
    ].join("\n");

    const content = await this.complete(`openclaw/${args.agentId}`, userPrompt);
    const validSlugs = new Set(args.members.map((m) => m.slug));
    return parsePlan(content, validSlugs, limit);
  }

  private async complete(model: string, userPrompt: string): Promise<string> {
    const fetchImpl = this.deps.fetchImpl ?? globalThis.fetch;
    const response = await fetchImpl(
      `${this.deps.gatewayBaseUrl}/v1/chat/completions`,
      {
        method: "POST",
        // Bound the wait: the endpoint runs a full agent turn, so a wedged
        // gateway must not hang the team request forever.
        signal: AbortSignal.timeout(PLAN_TIMEOUT_MS),
        headers: {
          "Content-Type": "application/json",
          ...(this.deps.gatewayToken
            ? { Authorization: `Bearer ${this.deps.gatewayToken}` }
            : {}),
        },
        body: JSON.stringify({
          model,
          stream: false,
          temperature: 0.2,
          messages: [{ role: "user", content: userPrompt }],
        }),
      },
    );
    if (!response.ok) {
      throw new Error(
        `team planner completion failed: ${response.status} ${response.statusText}`,
      );
    }
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    return typeof content === "string" ? content : "";
  }
}

/**
 * Extracts a `[...]` array from possibly-fenced/prose-wrapped model output,
 * then keeps only well-formed subtasks assigned to known members.
 */
function parsePlan(
  content: string,
  validSlugs: ReadonlySet<string>,
  limit: number,
): TeamSubtaskInput[] {
  const json = extractJsonArray(content);
  if (!json) {
    logger.warn({}, "team planner: no JSON array found in model output");
    return [];
  }
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    logger.warn({}, "team planner: JSON parse failed");
    return [];
  }
  if (!Array.isArray(raw)) {
    return [];
  }

  const out: TeamSubtaskInput[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const title = typeof record.title === "string" ? record.title.trim() : "";
    const assigneeSlug =
      typeof record.assigneeSlug === "string" ? record.assigneeSlug.trim() : "";
    if (!title || !validSlugs.has(assigneeSlug)) {
      continue;
    }
    const notes =
      typeof record.notes === "string" && record.notes.trim()
        ? record.notes.trim().slice(0, 8_000)
        : undefined;
    out.push({
      title: title.slice(0, 200),
      assigneeSlug,
      ...(notes ? { notes } : {}),
    });
    if (out.length >= limit) {
      break;
    }
  }
  return out;
}

/** Scan for the first balanced top-level JSON array in a string. */
function extractJsonArray(content: string): string | null {
  const start = content.indexOf("[");
  if (start === -1) {
    return null;
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < content.length; i++) {
    const ch = content[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "[") {
      depth++;
    } else if (ch === "]") {
      depth--;
      if (depth === 0) {
        return content.slice(start, i + 1);
      }
    }
  }
  return null;
}
