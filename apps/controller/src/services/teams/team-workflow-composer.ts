import {
  type CreateTeamWorkflowRequest,
  createTeamWorkflowRequestSchema,
} from "@nexu/shared";
import { logger } from "../../lib/logger.js";
import {
  WorkflowValidationError,
  templateVariables,
  validateWorkflowDefinition,
} from "./team-workflow-service.js";

/** An expert the composer may assign steps to. */
export type ComposerCatalogExpert = {
  slug: string;
  name: string;
  description: string;
};

export type WorkflowComposerDeps = {
  /** Gateway HTTP base, e.g. http://127.0.0.1:18789 (OpenAI-compatible). */
  gatewayBaseUrl: string;
  gatewayToken: string | null;
  fetchImpl?: typeof globalThis.fetch;
};

/** Composing is one long completion; abort if the gateway wedges. */
const COMPOSE_TIMEOUT_MS = 120_000;
/** Fuzzy-repair budget: beyond this edit distance we refuse to guess. */
const MAX_SLUG_EDIT_DISTANCE = 8;
const MAX_VAR_EDIT_DISTANCE = 6;

const SYSTEM_PROMPT = [
  "You design multi-agent workflows (SOPs) for a team of AI experts.",
  "The user describes a goal in one sentence; you produce a workflow: which",
  "experts to involve and the step DAG they execute.",
  "",
  "Output STRICT JSON only — one object, no prose, no markdown fences:",
  "{",
  '  "name": string,            // short workflow name in the user\'s language',
  '  "description": string,     // one line',
  '  "inputs": [{"name": snake_case, "description": string, "required": boolean}],',
  '  "steps": [{"id": snake_case, "assigneeSlug": string, "name": string,',
  '             "task": string, "output": snake_case, "dependsOn": [stepId]}]',
  "}",
  "",
  "Rules:",
  "- Pick 2-6 experts from the catalog below. assigneeSlug MUST be an exact",
  "  catalog slug — never invent one.",
  "- Prefer parallel steps: only add dependsOn when a step truly consumes an",
  "  upstream output.",
  "- Variable chaining: a step's task references values as {{var}}. Every",
  "  {{var}} must be an input name or the output of a step listed (directly",
  "  or transitively) in that step's dependsOn. A step that merges several",
  "  outputs must list all their producing steps in dependsOn.",
  "- Keep inputs minimal (1-3): only what the user must provide per run.",
  "- Every step's task ends by demanding the deliverable itself only — no",
  "  preamble, no meta commentary.",
  "- The final step must produce the finished deliverable the user asked for.",
  "- Write name/task text in the same language as the user's description.",
].join("\n");

/**
 * One-sentence auto-compose (design doc P2). The model drafts the workflow;
 * a deterministic repair layer then fixes the failure modes LLM-composed
 * DAGs are known for — invented expert slugs, dangling {{vars}}, missing
 * dependsOn edges — and structural validation gates the result.
 */
export class WorkflowComposer {
  constructor(private readonly deps: WorkflowComposerDeps) {}

  async compose(args: {
    description: string;
    model: string;
    catalog: readonly ComposerCatalogExpert[];
  }): Promise<{ draft: CreateTeamWorkflowRequest; warnings: string[] }> {
    const catalogBlock = args.catalog
      .map(
        (expert) => `- ${expert.slug} | ${expert.name} | ${expert.description}`,
      )
      .join("\n");
    // The gateway endpoint runs a full agent turn; instructions carried in a
    // `system` message get diluted by the agent's own persona, so everything
    // rides in the user message.
    const userPrompt = [
      SYSTEM_PROMPT,
      "",
      "Expert catalog:",
      catalogBlock,
      "",
      "Goal:",
      args.description,
    ].join("\n");

    const content = await this.complete(args.model, userPrompt);
    return repairComposedDraft(content, args.catalog);
  }

  private async complete(model: string, userPrompt: string): Promise<string> {
    const fetchImpl = this.deps.fetchImpl ?? globalThis.fetch;
    const response = await fetchImpl(
      `${this.deps.gatewayBaseUrl}/v1/chat/completions`,
      {
        method: "POST",
        signal: AbortSignal.timeout(COMPOSE_TIMEOUT_MS),
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
        `workflow compose completion failed: ${response.status} ${response.statusText}`,
      );
    }
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    return typeof content === "string" ? content : "";
  }
}

// ---------------------------------------------------------------------------
// Repair layer (exported for tests)
// ---------------------------------------------------------------------------

/**
 * Parse + repair a model-composed draft. Applies, in order: JSON extraction,
 * shape normalization, expert-slug fuzzy repair, {{var}} fuzzy repair,
 * missing-dependsOn repair, then full structural validation. Throws
 * {@link WorkflowValidationError} when the draft cannot be made sound.
 */
export function repairComposedDraft(
  content: string,
  catalog: readonly ComposerCatalogExpert[],
): { draft: CreateTeamWorkflowRequest; warnings: string[] } {
  const warnings: string[] = [];
  const json = extractJsonObject(content);
  if (!json) {
    throw new WorkflowValidationError(
      "the model did not return a JSON workflow draft",
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new WorkflowValidationError(
      "the model returned malformed JSON for the workflow draft",
    );
  }
  const normalized = normalizeDraft(raw);

  // 1. Expert slug repair (LLM hallucination is the #1 failure mode).
  const catalogSlugs = catalog.map((expert) => expert.slug);
  const catalogSet = new Set(catalogSlugs);
  for (const step of normalized.steps) {
    if (catalogSet.has(step.assigneeSlug)) {
      continue;
    }
    const nearest = nearestString(
      step.assigneeSlug,
      catalogSlugs,
      MAX_SLUG_EDIT_DISTANCE,
    );
    if (!nearest) {
      throw new WorkflowValidationError(
        `composed step "${step.id}" uses unknown expert "${step.assigneeSlug}" and no close catalog match exists`,
      );
    }
    warnings.push(
      `步骤 ${step.id}：专家 "${step.assigneeSlug}" 不存在，已替换为 "${nearest}"`,
    );
    step.assigneeSlug = nearest;
  }

  // 2. dependsOn repair: unknown/self references.
  const stepIds = new Set(normalized.steps.map((step) => step.id));
  for (const step of normalized.steps) {
    step.dependsOn = step.dependsOn
      .filter((dep) => {
        if (dep === step.id) {
          warnings.push(`步骤 ${step.id}：移除了对自身的依赖`);
          return false;
        }
        return true;
      })
      .map((dep) => {
        if (stepIds.has(dep)) {
          return dep;
        }
        const nearest = nearestString(dep, [...stepIds], MAX_VAR_EDIT_DISTANCE);
        if (nearest) {
          warnings.push(
            `步骤 ${step.id}：依赖 "${dep}" 不存在，已替换为 "${nearest}"`,
          );
          return nearest;
        }
        warnings.push(`步骤 ${step.id}：移除了未知依赖 "${dep}"`);
        return "";
      })
      .filter(Boolean);
  }

  // 3. {{var}} repair: fuzzy-fix names, then add missing dependsOn edges.
  const inputNames = new Set(normalized.inputs.map((input) => input.name));
  const producerByOutput = new Map<string, string>();
  for (const step of normalized.steps) {
    if (step.output) {
      producerByOutput.set(step.output, step.id);
    }
  }
  const knownVars = [...inputNames, ...producerByOutput.keys()];
  for (const step of normalized.steps) {
    for (const varName of templateVariables(step.task)) {
      let resolved = varName;
      if (!inputNames.has(varName) && !producerByOutput.has(varName)) {
        const nearest = nearestString(
          varName,
          knownVars,
          MAX_VAR_EDIT_DISTANCE,
        );
        if (!nearest) {
          throw new WorkflowValidationError(
            `composed step "${step.id}" references {{${varName}}} which matches no input or step output`,
          );
        }
        warnings.push(
          `步骤 ${step.id}：变量 {{${varName}}} 不存在，已替换为 {{${nearest}}}`,
        );
        step.task = step.task.replaceAll(`{{${varName}}}`, `{{${nearest}}}`);
        resolved = nearest;
      }
      const producer = producerByOutput.get(resolved);
      if (
        producer &&
        producer !== step.id &&
        !step.dependsOn.includes(producer)
      ) {
        // The value would race without the edge — add it (AO's rule).
        warnings.push(
          `步骤 ${step.id}：补上了对产出 {{${resolved}}} 的步骤 "${producer}" 的依赖`,
        );
        step.dependsOn.push(producer);
      }
    }
  }

  // 4. Authoritative shape check, then structural validation against a
  //    synthetic team of exactly the chosen experts (membership is ensured
  //    at save time).
  const parsed = createTeamWorkflowRequestSchema.safeParse(normalized);
  if (!parsed.success) {
    logger.warn(
      { issues: parsed.error.issues.slice(0, 3) },
      "composed draft failed schema validation",
    );
    throw new WorkflowValidationError(
      `composed draft is malformed: ${parsed.error.issues[0]?.message ?? "schema error"}`,
    );
  }
  const syntheticTeam = {
    members: [
      ...new Set(parsed.data.steps.map((step) => step.assigneeSlug)),
    ].map((slug) => ({ expertSlug: slug, botId: `synthetic-${slug}` })),
  };
  validateWorkflowDefinition(parsed.data, syntheticTeam);
  return { draft: parsed.data, warnings };
}

type NormalizedDraft = {
  name: string;
  description?: string;
  inputs: Array<{
    name: string;
    description?: string;
    required: boolean;
    default?: string;
  }>;
  steps: Array<{
    id: string;
    type: "task";
    assigneeSlug: string;
    name?: string;
    task: string;
    output?: string;
    dependsOn: string[];
  }>;
};

/** Coerce loose model output into the draft shape (drop junk, clamp, snake_case ids). */
function normalizeDraft(raw: unknown): NormalizedDraft {
  const record = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  const inputsRaw = Array.isArray(record.inputs) ? record.inputs : [];
  const stepsRaw = Array.isArray(record.steps) ? record.steps : [];

  const inputs = inputsRaw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const input = entry as Record<string, unknown>;
    const name = snakeCase(String(input.name ?? ""));
    if (!name) {
      return [];
    }
    return [
      {
        name,
        description:
          typeof input.description === "string"
            ? input.description.slice(0, 200)
            : undefined,
        required: input.required === true,
        default:
          typeof input.default === "string"
            ? input.default.slice(0, 4_000)
            : undefined,
      },
    ];
  });

  const steps = stepsRaw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const step = entry as Record<string, unknown>;
    const id = snakeCase(String(step.id ?? ""));
    const task = typeof step.task === "string" ? step.task.trim() : "";
    const assigneeSlug =
      typeof step.assigneeSlug === "string" ? step.assigneeSlug.trim() : "";
    if (!id || !task || !assigneeSlug) {
      return [];
    }
    const output = snakeCase(String(step.output ?? ""));
    return [
      {
        id,
        type: "task" as const,
        assigneeSlug,
        name:
          typeof step.name === "string" && step.name.trim()
            ? step.name.trim().slice(0, 60)
            : undefined,
        task: task.slice(0, 8_000),
        output: output || undefined,
        dependsOn: Array.isArray(step.dependsOn)
          ? step.dependsOn
              .filter((dep): dep is string => typeof dep === "string")
              .map((dep) => snakeCase(dep))
              .filter(Boolean)
          : [],
      },
    ];
  });

  return {
    name:
      typeof record.name === "string" && record.name.trim()
        ? record.name.trim().slice(0, 80)
        : "自动生成的工作流",
    description:
      typeof record.description === "string"
        ? record.description.slice(0, 280)
        : undefined,
    inputs,
    steps,
  };
}

/** Lowercase snake_case-ify an identifier the way the schema demands. */
function snakeCase(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[0-9]+/, "")
    .slice(0, 40);
}

/** Nearest candidate within an edit-distance budget (substring hits win). */
export function nearestString(
  target: string,
  candidates: readonly string[],
  maxDistance: number,
): string | null {
  const lower = target.toLowerCase();
  const containing = candidates.filter(
    (candidate) =>
      candidate.toLowerCase().includes(lower) ||
      lower.includes(candidate.toLowerCase()),
  );
  if (containing.length > 0) {
    // Prefer the shortest containing candidate — closest in specificity.
    return [...containing].sort((a, b) => a.length - b.length)[0] ?? null;
  }
  let best: string | null = null;
  let bestDistance = maxDistance + 1;
  for (const candidate of candidates) {
    const distance = levenshtein(lower, candidate.toLowerCase());
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return bestDistance <= maxDistance ? best : null;
}

function levenshtein(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  const previous = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) {
    previous[j] = j;
  }
  for (let i = 1; i <= a.length; i++) {
    let diagonal = previous[0] as number;
    previous[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = previous[j] as number;
      previous[j] = Math.min(
        above + 1,
        (previous[j - 1] as number) + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[b.length] as number;
}

/** Scan for the first balanced top-level JSON object in a string. */
function extractJsonObject(content: string): string | null {
  const start = content.indexOf("{");
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
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return content.slice(start, i + 1);
      }
    }
  }
  return null;
}
