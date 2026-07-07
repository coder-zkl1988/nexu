# expert_run_auto → DAG execution (honor dependsOn + data hand-off)

Status: proposed (2026-07-07)
Related: `specs/design-docs/2026-07-01-team-workflow-sop-and-autocompose.md`

## Problem (observed)

A "Team Run Auto" for「调研小红书话题→分析→生成10篇」produced:
- 搜索(task1): `subtask timed out after 600000ms`.
- 分析(task2): "已完成" but "未找到任何调研数据" — it ran with no research output to consume.
- 生成(task3): `Agent "…" no longer exists in configuration`.

Task2's "no data" is the headline symptom: it ran **in parallel** with task1 and never received task1's output.

## Root cause (confirmed in code)

Two team-execution paths exist:

1. **Auto path** — `expert_run_auto` → `TeamService.runTaskAutoDefault` (`team-service.ts:412`) → `planner.planSubtasks` (flat, `team-planner.ts`) → `dispatchSubtasks` (`team-service.ts:493`). `dispatchSubtasks` fires every subtask at once: `valid.forEach(... runs.push(this.runSubtaskCard(...)))` then `void Promise.allSettled(runs)` — **all-parallel, no ordering, no data hand-off**. The subtask schema `teamSubtaskInputSchema` (`packages/shared/src/schemas/team.ts:71`) carries only `title/assigneeSlug/notes` — **no `id`, no `dependsOn`** — so dependency info can't even reach this executor.

2. **Workflow path** — `TeamWorkflowService.runWorkflow` (`team-workflow-service.ts:314`): `topologicalLevels` (Kahn, cycle-checked) → per-wave `Promise.allSettled(level.map(runStep))` → **wave-sequential, in-wave-parallel**; `{{var}}` placeholders resolve from `inputs ∪ transitive-upstream outputs`; a failed wave triggers `abortRemaining` (downstream cards blocked, not run empty). Fed by `WorkflowComposer.compose` (`team-workflow-composer.ts:71`) which LLM-drafts a validated DAG (`{id, assigneeSlug, name, task, output, dependsOn}`) + a deterministic repair layer.

**The auto path simply doesn't use the DAG engine.** Everything needed (topological execution, data hand-off, failure propagation, cycle/placeholder validation, approvals, restart-survival) already exists and is proven in path 2.

## REVISION (2026-07-07, after wiring investigation) — cleaner than the draft below

`TeamWorkflowService` already owns every piece: `composeWorkflow`/`composeDraft` (compose), `ensureTeamMembers` dep (enroll + auto-install), and `runWorkflowDefinition` (T1). So the auto path needs **no injection into `TeamService`** (which is constructed before `teamWorkflowService` anyway). Instead:

- **New method `TeamWorkflowService.autoComposeAndRun(teamId, description, input?={inputs:{}})`** — mirrors `createWorkflow` (compose draft → `ensureTeamMembers(distinct assigneeSlugs)` → build a `TeamWorkflow` **without persisting**) then `return this.runWorkflowDefinition(team, ephemeral, input)`. Entirely self-contained on `teamWorkflowService`'s existing deps; container untouched.
- **Route orchestration** (`team-routes.ts`): `POST /teams/default/run-auto` → `teamService.ensureDefaultTeam()` then `teamWorkflowService.autoComposeAndRun(team.id, input.task)`; `POST /teams/{id}/run-auto` → `teamWorkflowService.autoComposeAndRun(id, input.task)`. The old `teamService.runTaskAutoDefault/runTaskAuto` (+ `planSubtasks`/`dispatchSubtasks`) become dead for the auto path — leave them for now, remove in a follow-up.
- Response schema + plugin/web (T4/T5) unchanged in intent: the auto endpoints now return the `RunTeamWorkflowResponse` shape (`runId/boardId/parentCardId/cards[]`) + the composed steps for display.

Revised task order: **T2** = add `autoComposeAndRun`; **T3** = repoint routes + response schema + generate-types; **T5** = plugin/web; **T6** = gate. (Container-injection T2 in the draft below is obsolete.)

## Approach A (chosen): route the auto path through the existing DAG engine

Replace the auto path's `planSubtasks + dispatchSubtasks` with `compose + runWorkflowDefinition`. **The workflow engine is not modified** — only refactored to expose an ephemeral (non-persisted) run entrypoint.

### Core refactor — ephemeral run entrypoint (small, surgical)

`runWorkflow` is bound to persistence only at `team-workflow-service.ts:320` (`getWorkflow`). Everything from L322→L402 operates on the in-memory `workflow` object. Extract that body:

```
async runWorkflow(teamId, workflowId, input) {
  const team = this.requireTeam(teamId);
  const workflow = this.getWorkflow(teamId, workflowId);   // persisted lookup
  return this.runWorkflowDefinition(team, workflow, input);
}

// NEW — used by both persisted runs and the auto path
async runWorkflowDefinition(team, workflow /* TeamWorkflow */, input) {
  validateWorkflowDefinition(workflow, team);
  // …existing L322→L402 verbatim…
  return { runId, boardId, parentCardId, cards };
}
```

No behavior change for persisted workflows (same tests stay green).

### Auto path swap (`team-service.ts` `runTaskAutoDefault`, and `runTaskAuto`)

```
const team = await this.ensureDefaultTeam();
const catalog = await this.deps.recallExperts(input.task);          // existing
const { draft, warnings } = await this.deps.composer.compose({       // NEW
  description: input.task,
  model: <lead bot model>,                                           // like planSubtasks' agentId
  catalog: catalog.map(toComposerExpert),
});
// enroll every assignee in draft.steps that isn't a member yet (REUSE L428-437)
const ephemeral: TeamWorkflow = { id: this.deps.genId(), ...draft }; // ephemeral, not persisted
const result = await this.deps.workflowService.runWorkflowDefinition(
  effectiveTeam, ephemeral, { inputs: {} },
);
return { ...mapToAutoResponse(result), plan: draft.steps, teamId: team.id };
```

Keep `dispatchSubtasks` + `runTask` (Phase-1 manual, explicit subtasks, no deps) as-is — scope this change to the AUTO paths only.

### Touch points

| # | File | Change |
|---|---|---|
| 1 | `team-workflow-service.ts` | Extract `runWorkflowDefinition(team, workflow, input)`; `runWorkflow` delegates. |
| 2 | `team-service.ts` | `runTaskAutoDefault` / `runTaskAuto`: `compose → enroll → runWorkflowDefinition` instead of `planSubtasks → dispatchSubtasks`. Add `composer` + `workflowService` to deps. |
| 3 | `container.ts` | Wire `WorkflowComposer` + `TeamWorkflowService` into `TeamService` deps (already constructed for the workflow routes — just inject). |
| 4 | `packages/shared/src/schemas/team.ts` | Align `RunDefaultTeamTaskResponse` / `AutoRunTeamTaskResponse`: `started[]` → `cards[{stepId,cardId}]` + `runId`; `plan` becomes DAG steps (with `dependsOn`). |
| 5 | `nexu-team/index.js` | `expert_run_auto` result → run-card builder: consume `cards`/`runId` shape (board + parent/child cards are identical, so the card visual is largely unchanged). |
| 6 | web `TeamRunCard` / canvas per-step nodes (#17) | Verify board-polling + per-step nodes render off the same board cards (expected compatible — both paths call `workboardCardCreate/Decompose`). Adjust only if the response shape is read directly. |
| 7 | `pnpm generate-types` | schema changed → regenerate SDK. |

### Inputs / `{{var}}` note

The composer folds the goal into each step's `task` text and chains steps via `{{upstream_output}}` (its prompt + repair guarantee every `{{var}}` traces to a `dependsOn` producer). For one-sentence auto, `runWorkflowDefinition(..., { inputs: {} })` should suffice; confirm `resolveRunInputs` tolerates an empty inputs map when the draft declares none (add a passthrough if the composer emits a `{{task}}`-style input).

## Outcome (maps to the 3 symptoms)

- 分析 no-data → **fixed**: 分析 depends on 搜索; runs only after it, receives its `{{output}}`.
- Parallel-when-should-serialize → **fixed**: topological waves; independent steps still parallel.
- Upstream fail → downstream empty → **fixed**: `abortRemaining` blocks downstream instead of running them dry.

## Adjacent hardening (separate, do NOT bundle unless asked)

- **task3 "Agent no longer exists in configuration"** — assignee bot present in the team but absent from compiled OpenClaw agents (config drift, same class as the earlier `pickUtilityBotId` stale-bot issue). Add a pre-run check that every assignee `botId` exists in the compiled agents; on miss, re-sync then fail with a clear message. `validateWorkflowDefinition` only checks team membership, not compiled presence.
- **task1 600s timeout** — probabilistic completion-signal (known workboard issue; see memory `workboard-worker-engine-stall.md`). Independent of ordering. Options: tune `stepTimeoutMs`, or add a session-status fallback poll. Track separately.

## Non-goals

- No change to the workflow engine's execution semantics, approvals, or persistence.
- No change to the manual `runTask` (explicit-subtasks) path.
- Not fixing the completion-signal timeout or bot-drift in this change (listed above as separate).

## SDD task breakdown

- **T1** — Extract `runWorkflowDefinition`; `runWorkflow` delegates. Verify: existing team-workflow tests green, zero behavior change for persisted runs.
- **T2** — Wire `composer` + `workflowService` into `TeamService` deps (`container.ts`). Verify: typecheck + DI smoke.
- **T3** — Swap `runTaskAutoDefault` / `runTaskAuto` to `compose → enroll → runWorkflowDefinition`. Verify: unit test — a task that implies a chain produces steps with `dependsOn`; the run creates dependency-linked cards; a mocked composer + workflowService asserts the call path.
- **T4** — Response schema alignment + `pnpm generate-types`. Verify: typecheck across web; SDK regenerated.
- **T5** — Plugin `expert_run_auto` run-card + web render compat. Verify: run-card builds from the new shape; per-step canvas nodes still render (board-driven).
- **T6** — Live gate: real "调研→分析→生成" auto run in desktop → 分析 card shows it consumed 搜索's output; waves ordered; no "no data".

## Verification

`pnpm --filter @nexu/shared build` → `pnpm generate-types` → `pnpm typecheck` → `pnpm --filter @nexu/controller test` → `pnpm lint`. Live gate T6 in packaged/dev desktop.

## Delivery + live-gate result (2026-07-08)

Landed via SDD: `fbe1d594` (T1 extract runWorkflowDefinition) → `98257dac` (T2 autoComposeAndRun, ephemeral) → `974b2f4e` (T3 route repoint + `runAutoTeamTaskResponseSchema` + generate-types; reviewer APPROVE) → `3b2a151d` (T5 expert_run_auto DAG run-card; web already compatible). Controller 501 / web 575 green, typecheck + lint clean.

**T6 live gate — PASSED.** `POST /teams/default/run-auto {task: "调研小红书话题…并基于调研生成10篇帖子"}` (HTTP 200, 14.8s compose) returned a real DAG, not a flat list:
- steps: `research_trending_topics` (dependsOn `[]`) ← root; `generate_posts` (dependsOn `["research_trending_topics"]`).
- board card states: research = **running**, generate = **todo (waiting)** — topological gating confirmed (old flat path ran both in parallel). This is the exact fix for the observed "分析空跑没数据".
- Data hand-off (`{{upstream output}}`) is engine-guaranteed (unchanged, tested, reviewer-confirmed).

Follow-ups (not blocking, tracked separately):
- Parent orchestration card is marked `done` on decompose while children still run — pre-existing workboard semantic (visible in the original flat-path screenshot too), not introduced here. Parent status should reflect children rollup.
- Sanitize team compose/gateway upstream failures to a 502 (currently bare Hono 500; no leak) — chipped as a background task.
- Remove the now-dead `TeamService.runTaskAutoDefault`/`runTaskAuto` (+ their `Pick` entries + old response schemas); kept with `TODO(dag-cleanup)`.

## Cross-project sync

On acceptance, sync this plan to `agent-digital-cowork/clone/design/` per AGENTS.md sync rules.
