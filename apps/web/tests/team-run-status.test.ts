import { describe, expect, it } from "vitest";
import { rollupColumnKey, rollupRunStatus } from "../src/lib/team-run-status";

// A team run's displayed status must roll up from its CHILD step cards, never
// the parent orchestration card — the workboard marks the parent `done` the
// instant it decomposes (to un-gate the children), so the parent's own status
// is not a completion signal. See
// specs/exec-plans/2026-07-07-expert-run-auto-dag-execution.md (follow-up).
describe("rollupRunStatus", () => {
  it("is idle when there are no children to roll up", () => {
    expect(rollupRunStatus([])).toBe("idle");
  });

  it("is done only when every child is done", () => {
    expect(rollupRunStatus(["done", "done"])).toBe("done");
    expect(rollupRunStatus(["done"])).toBe("done");
  });

  // The reported bug: while the root step runs, the run must NOT read done even
  // though the parent card is already `done`.
  it("stays running while any child is still todo/running/ready", () => {
    expect(rollupRunStatus(["running", "todo"])).toBe("running");
    expect(rollupRunStatus(["done", "running"])).toBe("running");
    expect(rollupRunStatus(["todo", "todo"])).toBe("running");
    expect(rollupRunStatus(["ready", "review"])).toBe("running");
  });

  it("treats an unreported (undefined) child as still progressing, never done", () => {
    // A child card that hasn't surfaced on the board yet must not let the run
    // read done just because its known siblings happen to be done.
    expect(rollupRunStatus(["done", undefined])).toBe("running");
    expect(rollupRunStatus([undefined, undefined])).toBe("running");
  });

  it("is blocked only when a child is blocked and none are progressing", () => {
    expect(rollupRunStatus(["done", "blocked"])).toBe("blocked");
    expect(rollupRunStatus(["blocked"])).toBe("blocked");
    expect(rollupRunStatus(["blocked", "blocked"])).toBe("blocked");
  });

  it("lets running dominate blocked (blocked requires nothing else moving)", () => {
    expect(rollupRunStatus(["running", "blocked"])).toBe("running");
    expect(rollupRunStatus(["todo", "blocked"])).toBe("running");
  });
});

describe("rollupColumnKey", () => {
  it("maps a rollup onto the team board Kanban column", () => {
    expect(rollupColumnKey("done")).toBe("done");
    expect(rollupColumnKey("running")).toBe("running");
    expect(rollupColumnKey("blocked")).toBe("blocked");
    // A run with no children yet parks the orchestration card in todo, never
    // done.
    expect(rollupColumnKey("idle")).toBe("todo");
  });
});
