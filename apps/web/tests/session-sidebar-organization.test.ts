import { describe, expect, it } from "vitest";
import {
  type SidebarSessionFilter,
  filterSidebarSessions,
  sortSidebarSessions,
} from "../src/layouts/workspace-layout";

type SidebarSessionInput = Parameters<typeof filterSidebarSessions>[0][number];

function session(
  id: string,
  overrides: Partial<SidebarSessionInput> = {},
): SidebarSessionInput {
  return {
    id,
    title: id,
    channelType: "web",
    lastTime: "2026-08-03T02:00:00.000Z",
    status: "active",
    sessionKey: `agent:bot-1:${id}`,
    category: null,
    pinned: false,
    unread: false,
    archived: false,
    checkpointCount: 0,
    runState: "idle",
    ...overrides,
  };
}

describe("sidebar session organization", () => {
  const sessions = [
    session("ordinary"),
    session("unread", { unread: true, category: "Launch" }),
    session("running", { runState: "running" }),
    session("failed", { runState: "failed" }),
    session("archived", { archived: true }),
    session("scheduled", {
      sessionKey: "agent:bot-1:schedule-daily",
    }),
    session("archived-scheduled", {
      sessionKey: "agent:bot-1:schedule-old",
      archived: true,
    }),
  ];

  it.each<[SidebarSessionFilter, string[]]>([
    ["all", ["ordinary", "unread", "running", "failed", "scheduled"]],
    ["conversations", ["ordinary", "unread", "running", "failed"]],
    ["scheduled", ["scheduled"]],
    ["unread", ["unread"]],
    ["running", ["running"]],
    ["failed", ["failed"]],
    ["archived", ["archived", "archived-scheduled"]],
  ])("filters %s sessions", (filter, expected) => {
    expect(
      filterSidebarSessions(sessions, "", filter).map((item) => item.id),
    ).toEqual(expected);
  });

  it("searches custom group names", () => {
    expect(
      filterSidebarSessions(sessions, "launch", "all").map((item) => item.id),
    ).toEqual(["unread"]);
  });

  it("keeps pinned sessions first and otherwise sorts by activity", () => {
    const sorted = sortSidebarSessions([
      session("newest", { lastTime: "2026-08-03T03:00:00.000Z" }),
      session("pinned", {
        pinned: true,
        lastTime: "2026-08-01T03:00:00.000Z",
      }),
      session("middle", { lastTime: "2026-08-03T02:30:00.000Z" }),
    ]);

    expect(sorted.map((item) => item.id)).toEqual([
      "pinned",
      "newest",
      "middle",
    ]);
  });
});
