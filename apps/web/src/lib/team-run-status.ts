/**
 * A team run's overall status is a rollup of its CHILD step cards — never the
 * parent orchestration card. The OpenClaw workboard marks the parent card
 * `done` the instant it is decomposed into children (a child card stays gated
 * until its parent reaches `done`; see the comment at
 * apps/controller/src/services/openclaw-gateway-service.ts), so the parent's
 * own `done` is a gating artifact, not a completion signal. Deriving the run's
 * displayed status from the children keeps the run card / board from reading
 * "已完成" while step cards are still running or blocked.
 */

export type RunRollupStatus = "idle" | "running" | "blocked" | "done";

/**
 * Roll up a run's child-card statuses into a single displayed status:
 * - `done`    — every child is done
 * - `running` — at least one child is still progressing (anything that is not
 *   done and not blocked, including an unreported `undefined` card)
 * - `blocked` — a child is blocked and nothing else is progressing
 * - `idle`    — there are no children to roll up yet
 *
 * `running` deliberately dominates `blocked`: the run is only "blocked" when a
 * child is blocked AND no sibling is still moving.
 */
export function rollupRunStatus(
  childStatuses: readonly (string | undefined)[],
): RunRollupStatus {
  if (childStatuses.length === 0) {
    return "idle";
  }
  if (childStatuses.every((status) => status === "done")) {
    return "done";
  }
  const anyProgressing = childStatuses.some(
    (status) => status !== "done" && status !== "blocked",
  );
  return anyProgressing ? "running" : "blocked";
}

/** Map a run rollup onto the team board's Kanban column key. */
export function rollupColumnKey(
  rollup: RunRollupStatus,
): "todo" | "running" | "blocked" | "done" {
  switch (rollup) {
    case "done":
      return "done";
    case "blocked":
      return "blocked";
    case "running":
      return "running";
    default:
      return "todo";
  }
}
