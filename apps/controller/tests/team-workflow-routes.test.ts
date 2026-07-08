import { describe, expect, it, vi } from "vitest";
import {
  type TeamWorkflowRoutesDeps,
  buildTeamWorkflowRoutes,
} from "../src/routes/team-workflow-routes.js";
import { TeamNotFoundError } from "../src/services/teams/team-service.js";
import { WorkflowValidationError } from "../src/services/teams/team-workflow-service.js";

/**
 * Build the workflow routes with every service method stubbed. Individual
 * tests override the one method under test; the rest stay inert `vi.fn()`s so
 * the `Pick<TeamWorkflowService, ...>` shape is satisfied without `any`.
 */
function buildDeps(
  overrides: Partial<TeamWorkflowRoutesDeps["teamWorkflowService"]> = {},
): TeamWorkflowRoutesDeps {
  return {
    teamWorkflowService: {
      listWorkflows: vi.fn(),
      getWorkflow: vi.fn(),
      createWorkflow: vi.fn(),
      updateWorkflow: vi.fn(),
      deleteWorkflow: vi.fn(),
      runWorkflow: vi.fn(),
      listTemplates: vi.fn(),
      instantiateTemplate: vi.fn(),
      composeWorkflow: vi.fn(),
      listPendingApprovals: vi.fn(),
      approveStep: vi.fn(),
      ...overrides,
    },
  };
}

describe("POST /teams/{id}/workflows/{workflowId}/run", () => {
  it("degrades an upstream compose/gateway failure to 502", async () => {
    const runWorkflow = vi.fn(async () => {
      throw new Error(
        "workflow compose completion failed: 503 Service Unavailable",
      );
    });
    const app = buildTeamWorkflowRoutes(buildDeps({ runWorkflow }));

    const res = await app.request("/my-team/workflows/wf-1/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inputs: {} }),
    });

    expect(res.status).toBe(502);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("运行启动失败，请稍后重试");
    // The raw upstream error/status must never reach the client.
    expect(body.message).not.toContain("503");
    expect(body.message).not.toContain("compose completion failed");
  });

  it("still maps a not-found to 404 (upstream mapping does not shadow it)", async () => {
    const runWorkflow = vi.fn(async () => {
      throw new TeamNotFoundError("ghost");
    });
    const app = buildTeamWorkflowRoutes(buildDeps({ runWorkflow }));

    const res = await app.request("/ghost/workflows/wf-1/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inputs: {} }),
    });

    expect(res.status).toBe(404);
  });
});

describe("POST /teams/{id}/workflows/compose", () => {
  it("degrades an upstream compose/gateway failure to 502", async () => {
    const composeWorkflow = vi.fn(async () => {
      throw new Error(
        "workflow compose completion failed: 503 Service Unavailable",
      );
    });
    const app = buildTeamWorkflowRoutes(buildDeps({ composeWorkflow }));

    const res = await app.request("/my-team/workflows/compose", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ description: "调研并写报告" }),
    });

    expect(res.status).toBe(502);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("运行启动失败，请稍后重试");
    expect(body.message).not.toContain("503");
    expect(body.message).not.toContain("compose completion failed");
  });

  it("still maps a validation failure to 400 (upstream mapping does not shadow it)", async () => {
    const composeWorkflow = vi.fn(async () => {
      throw new WorkflowValidationError("composed draft is malformed");
    });
    const app = buildTeamWorkflowRoutes(buildDeps({ composeWorkflow }));

    const res = await app.request("/my-team/workflows/compose", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ description: "nonsense" }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      message: "composed draft is malformed",
    });
  });
});
