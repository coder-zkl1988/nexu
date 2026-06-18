import { describe, expect, it, vi } from "vitest";
import { TeamPlanner } from "../src/services/teams/team-planner.js";

function plannerWithResponse(content: string, ok = true) {
  const fetchImpl = vi.fn(async () => ({
    ok,
    status: ok ? 200 : 500,
    statusText: ok ? "OK" : "Internal Server Error",
    json: async () => ({ choices: [{ message: { content } }] }),
  })) as unknown as typeof globalThis.fetch;
  const planner = new TeamPlanner({
    gatewayBaseUrl: "http://127.0.0.1:18789",
    gatewayToken: "tok",
    fetchImpl,
  });
  return { planner, fetchImpl };
}

const MEMBERS = [
  { slug: "reviewer", name: "Reviewer", description: "reviews code" },
  { slug: "writer", name: "Writer", description: "writes docs" },
];

describe("TeamPlanner", () => {
  it("parses a clean JSON array and keeps only valid member assignees", async () => {
    const { planner, fetchImpl } = plannerWithResponse(
      JSON.stringify([
        {
          title: "Review the diff",
          assigneeSlug: "reviewer",
          notes: "focus on auth",
        },
        { title: "Draft notes", assigneeSlug: "writer" },
        { title: "Bogus", assigneeSlug: "ghost" },
      ]),
    );

    const plan = await planner.planSubtasks({
      task: "ship it",
      members: MEMBERS,
      model: "link/x",
    });

    expect(plan).toEqual([
      {
        title: "Review the diff",
        assigneeSlug: "reviewer",
        notes: "focus on auth",
      },
      { title: "Draft notes", assigneeSlug: "writer" },
    ]);
    // posts to the OpenAI-compatible endpoint with bearer auth
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:18789/v1/chat/completions");
    expect(
      (init as RequestInit).headers as Record<string, string>,
    ).toMatchObject({ Authorization: "Bearer tok" });
  });

  it("extracts the JSON array from fenced / prose-wrapped output", async () => {
    const { planner } = plannerWithResponse(
      'Sure! Here is the plan:\n```json\n[{"title":"Do it","assigneeSlug":"reviewer"}]\n```\nHope that helps.',
    );
    const plan = await planner.planSubtasks({
      task: "t",
      members: MEMBERS,
      model: "m",
    });
    expect(plan).toEqual([{ title: "Do it", assigneeSlug: "reviewer" }]);
  });

  it("returns an empty plan when no JSON array is present", async () => {
    const { planner } = plannerWithResponse("I cannot help with that.");
    const plan = await planner.planSubtasks({
      task: "t",
      members: MEMBERS,
      model: "m",
    });
    expect(plan).toEqual([]);
  });

  it("caps the plan at maxSubtasks", async () => {
    const { planner } = plannerWithResponse(
      JSON.stringify([
        { title: "a", assigneeSlug: "reviewer" },
        { title: "b", assigneeSlug: "writer" },
        { title: "c", assigneeSlug: "reviewer" },
      ]),
    );
    const plan = await planner.planSubtasks({
      task: "t",
      members: MEMBERS,
      model: "m",
      maxSubtasks: 2,
    });
    expect(plan).toHaveLength(2);
  });

  it("throws when the completion endpoint returns a non-2xx response", async () => {
    const { planner } = plannerWithResponse("", false);
    await expect(
      planner.planSubtasks({ task: "t", members: MEMBERS, model: "m" }),
    ).rejects.toThrow(/team planner completion failed/);
  });
});
