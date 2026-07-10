import { describe, expect, it, vi } from "vitest";

// team-board pulls in the teams hooks (→ generated SDK); the placement helper
// under test is pure, so a stub keeps the import graph light.
vi.mock("../lib/api/sdk.gen", () => ({}));

import {
  boardColumnKeyForCard,
  orchestrationColumnFor,
} from "../src/components/teams/team-board";
import { rollupColumnKey, rollupRunStatus } from "../src/lib/team-run-status";

const LEAD = "bot-lead";
// Board mid-run: the workboard has already flipped the parent orchestration
// card to `done` on decompose, but the children are still working.
const parentCard = { agentId: LEAD, status: "done" };
const runningChild = { agentId: "bot-writer", status: "running" };
const todoChild = { agentId: "bot-editor", status: "todo" };
const midRun = [parentCard, runningChild, todoChild];
const midRunColumn = rollupColumnKey(
  rollupRunStatus(
    midRun.filter((c) => c.agentId !== LEAD).map((c) => c.status),
  ),
);

describe("boardColumnKeyForCard", () => {
  it("does not park the parent card in Done while a child still runs", () => {
    expect(midRunColumn).toBe("running");
    expect(boardColumnKeyForCard(parentCard, LEAD, midRunColumn)).toBe(
      "running",
    );
  });

  it("places child cards by their own status", () => {
    expect(boardColumnKeyForCard(runningChild, LEAD, midRunColumn)).toBe(
      "running",
    );
    expect(boardColumnKeyForCard(todoChild, LEAD, midRunColumn)).toBe("todo");
  });

  it("parks the parent in Done only once every child is done", () => {
    const doneChild = { agentId: "bot-writer", status: "done" };
    const column = rollupColumnKey(rollupRunStatus([doneChild.status]));
    expect(boardColumnKeyForCard(parentCard, LEAD, column)).toBe("done");
  });

  it("falls back to per-card placement before the lead id is known", () => {
    // leadBotId null (team still loading) → nothing is treated as the
    // orchestration card; each card uses its own status.
    expect(boardColumnKeyForCard(parentCard, null, midRunColumn)).toBe("done");
  });

  it("falls back to per-card placement when the rollup is null (≥2 runs)", () => {
    // A null orchestration column means the board cannot attribute children to
    // one parent, so the lead's own card status wins — a finished run's parent
    // stays in Done instead of being dragged out by another run.
    expect(boardColumnKeyForCard(parentCard, LEAD, null)).toBe("done");
    expect(
      boardColumnKeyForCard({ agentId: LEAD, status: "running" }, LEAD, null),
    ).toBe("running");
  });
});

describe("orchestrationColumnFor", () => {
  it("rolls the single run's parent up from its children", () => {
    // Exactly one orchestration card → every non-lead card is that run's child,
    // so the board-wide rollup is sound.
    const cards = [
      { agentId: LEAD, status: "done" }, // parent, flipped on decompose
      { agentId: "bot-writer", status: "running" },
      { agentId: "bot-editor", status: "todo" },
    ];
    expect(orchestrationColumnFor(cards, LEAD)).toBe("running");
  });

  it("returns null with ≥2 orchestration cards so a done run stays put", () => {
    // The board accumulates cards across runs with no per-run parent↔child
    // linkage. run-1 is finished (parent + children done); run-2 is in flight
    // (a child still running). A single board-wide rollup is unsound here.
    const run1Parent = { agentId: LEAD, status: "done" };
    const run2Parent = { agentId: LEAD, status: "done" };
    const multiRun = [
      run1Parent,
      { agentId: "bot-writer", status: "done" },
      { agentId: "bot-editor", status: "done" },
      run2Parent,
      { agentId: "bot-writer", status: "running" },
    ];
    expect(orchestrationColumnFor(multiRun, LEAD)).toBeNull();
    // Pre-fix, the all-cards rollup dragged BOTH done parents into `running`
    // (run-2's child is still progressing) — exactly the bug the guard fixes.
    const allCardsRollup = rollupColumnKey(
      rollupRunStatus(
        multiRun.filter((c) => c.agentId !== LEAD).map((c) => c.status),
      ),
    );
    expect(allCardsRollup).toBe("running");
    // With the guard (null), each parent falls back to its own status → Done.
    expect(boardColumnKeyForCard(run1Parent, LEAD, null)).toBe("done");
    expect(boardColumnKeyForCard(run2Parent, LEAD, null)).toBe("done");
  });

  it("returns null when the board has no orchestration card", () => {
    // Defensive: a board with no lead card (or an unknown lead id) must not
    // treat a member card as the orchestration card.
    const cardsWithNoLeadCard = [
      { agentId: "bot-writer", status: "running" },
      { agentId: "bot-editor", status: "todo" },
    ];
    expect(orchestrationColumnFor(cardsWithNoLeadCard, LEAD)).toBeNull();
    expect(orchestrationColumnFor(cardsWithNoLeadCard, null)).toBeNull();
  });
});
