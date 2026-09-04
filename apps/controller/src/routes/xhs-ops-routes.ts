import { type OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  xhsOpsAccountCreateSchema,
  xhsOpsAccountListResponseSchema,
  xhsOpsAccountResponseSchema,
  xhsOpsAccountUpdateSchema,
  xhsOpsPlanSuggestResponseSchema,
  xhsOpsProjectCreateSchema,
  xhsOpsProjectListResponseSchema,
  xhsOpsProjectResponseSchema,
  xhsOpsProjectUpdateSchema,
  xhsOpsRunCreateSchema,
  xhsOpsRunListQuerySchema,
  xhsOpsRunListResponseSchema,
  xhsOpsRunResponseSchema,
  xhsOpsRunUpdateSchema,
} from "@nexu/shared";
import type { ControllerContainer } from "../app/container.js";
import { logger } from "../lib/logger.js";
import { XhsOpsError } from "../services/xhs-ops-run-service.js";
import type { ControllerBindings } from "../types.js";

const TAGS = ["XHS Ops"];
const projectIdParamSchema = z.object({ projectId: z.string() });
const accountIdParamSchema = z.object({ accountId: z.string() });
const runIdParamSchema = z.object({ runId: z.string() });
const errorSchema = z.object({ message: z.string() });

/** Account create body: `projectId` comes from the path and wins over the body. */
const accountCreateBodySchema = xhsOpsAccountCreateSchema.partial({
  projectId: true,
});

const jsonError = (description: string) => ({
  content: { "application/json": { schema: errorSchema } },
  description,
});

function mapError(err: unknown): {
  status: 400 | 404 | 409 | 500;
  message: string;
} {
  if (err instanceof XhsOpsError) {
    return { status: err.status, message: err.message };
  }
  logger.error(
    { error: err instanceof Error ? err.message : String(err) },
    "xhs-ops: route failed",
  );
  return { status: 500, message: "小红书运营操作失败，请稍后重试" };
}

export function registerXhsOpsRoutes(
  app: OpenAPIHono<ControllerBindings>,
  container: ControllerContainer,
): void {
  const { xhsOpsStore: store, xhsOpsRunService: runService } = container;

  // ─── Plan suggestion ──────────────────────────────────────────────────────

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/xhs-ops/projects/{projectId}/plan-suggest",
      tags: TAGS,
      request: { params: projectIdParamSchema },
      responses: {
        200: {
          content: {
            "application/json": { schema: xhsOpsPlanSuggestResponseSchema },
          },
          description: "Deterministic per-account plan suggestions for today",
        },
        404: jsonError("Project not found"),
      },
    }),
    async (c) => {
      const { projectId } = c.req.valid("param");
      if (!(await store.getProject(projectId))) {
        return c.json({ message: "项目不存在" }, 404);
      }
      return c.json({ plans: await runService.suggestPlans(projectId) }, 200);
    },
  );

  // ─── Projects ──────────────────────────────────────────────────────────────

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/xhs-ops/projects",
      tags: TAGS,
      responses: {
        200: {
          content: {
            "application/json": { schema: xhsOpsProjectListResponseSchema },
          },
          description: "Project list",
        },
      },
    }),
    async (c) => c.json({ projects: await store.listProjects() }, 200),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/xhs-ops/projects",
      tags: TAGS,
      request: {
        body: {
          content: {
            "application/json": { schema: xhsOpsProjectCreateSchema },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: xhsOpsProjectResponseSchema },
          },
          description: "Created project",
        },
      },
    }),
    async (c) =>
      c.json({ project: await store.createProject(c.req.valid("json")) }, 200),
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/xhs-ops/projects/{projectId}",
      tags: TAGS,
      request: { params: projectIdParamSchema },
      responses: {
        200: {
          content: {
            "application/json": { schema: xhsOpsProjectResponseSchema },
          },
          description: "Project",
        },
        404: jsonError("Project not found"),
      },
    }),
    async (c) => {
      const project = await store.getProject(c.req.valid("param").projectId);
      if (!project) return c.json({ message: "项目不存在" }, 404);
      return c.json({ project }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "patch",
      path: "/api/v1/xhs-ops/projects/{projectId}",
      tags: TAGS,
      request: {
        params: projectIdParamSchema,
        body: {
          content: {
            "application/json": { schema: xhsOpsProjectUpdateSchema },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: xhsOpsProjectResponseSchema },
          },
          description: "Updated project",
        },
        404: jsonError("Project not found"),
      },
    }),
    async (c) => {
      const project = await store.updateProject(
        c.req.valid("param").projectId,
        c.req.valid("json"),
      );
      if (!project) return c.json({ message: "项目不存在" }, 404);
      return c.json({ project }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/api/v1/xhs-ops/projects/{projectId}",
      tags: TAGS,
      request: { params: projectIdParamSchema },
      responses: {
        200: {
          content: {
            "application/json": { schema: xhsOpsProjectResponseSchema },
          },
          description: "Deleted project (accounts and runs cascade)",
        },
        404: jsonError("Project not found"),
      },
    }),
    async (c) => {
      const project = await store.deleteProject(c.req.valid("param").projectId);
      if (!project) return c.json({ message: "项目不存在" }, 404);
      return c.json({ project }, 200);
    },
  );

  // ─── Accounts ──────────────────────────────────────────────────────────────

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/xhs-ops/projects/{projectId}/accounts",
      tags: TAGS,
      request: { params: projectIdParamSchema },
      responses: {
        200: {
          content: {
            "application/json": { schema: xhsOpsAccountListResponseSchema },
          },
          description: "Accounts of the project",
        },
        404: jsonError("Project not found"),
      },
    }),
    async (c) => {
      const { projectId } = c.req.valid("param");
      if (!(await store.getProject(projectId))) {
        return c.json({ message: "项目不存在" }, 404);
      }
      return c.json(
        { accounts: await store.listAccountsByProject(projectId) },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/xhs-ops/projects/{projectId}/accounts",
      tags: TAGS,
      request: {
        params: projectIdParamSchema,
        body: {
          content: { "application/json": { schema: accountCreateBodySchema } },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: xhsOpsAccountResponseSchema },
          },
          description: "Created account",
        },
        400: jsonError("Body projectId does not match the path"),
        404: jsonError("Project not found"),
      },
    }),
    async (c) => {
      const { projectId } = c.req.valid("param");
      const body = c.req.valid("json");
      if (body.projectId !== undefined && body.projectId !== projectId) {
        return c.json({ message: "请求体 projectId 与路径不一致" }, 400);
      }
      if (!(await store.getProject(projectId))) {
        return c.json({ message: "项目不存在" }, 404);
      }
      const account = await store.createAccount({ ...body, projectId });
      return c.json({ account }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/xhs-ops/accounts/{accountId}",
      tags: TAGS,
      request: { params: accountIdParamSchema },
      responses: {
        200: {
          content: {
            "application/json": { schema: xhsOpsAccountResponseSchema },
          },
          description: "Account",
        },
        404: jsonError("Account not found"),
      },
    }),
    async (c) => {
      const account = await store.getAccount(c.req.valid("param").accountId);
      if (!account) return c.json({ message: "账号不存在" }, 404);
      return c.json({ account }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "patch",
      path: "/api/v1/xhs-ops/accounts/{accountId}",
      tags: TAGS,
      request: {
        params: accountIdParamSchema,
        body: {
          content: {
            "application/json": { schema: xhsOpsAccountUpdateSchema },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: xhsOpsAccountResponseSchema },
          },
          description: "Updated account",
        },
        404: jsonError("Account not found"),
      },
    }),
    async (c) => {
      const account = await store.updateAccount(
        c.req.valid("param").accountId,
        c.req.valid("json"),
      );
      if (!account) return c.json({ message: "账号不存在" }, 404);
      return c.json({ account }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/api/v1/xhs-ops/accounts/{accountId}",
      tags: TAGS,
      request: { params: accountIdParamSchema },
      responses: {
        200: {
          content: {
            "application/json": { schema: xhsOpsAccountResponseSchema },
          },
          description: "Deleted account",
        },
        404: jsonError("Account not found"),
      },
    }),
    async (c) => {
      const account = await store.deleteAccount(c.req.valid("param").accountId);
      if (!account) return c.json({ message: "账号不存在" }, 404);
      return c.json({ account }, 200);
    },
  );

  // ─── Runs ──────────────────────────────────────────────────────────────────

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/xhs-ops/runs",
      tags: TAGS,
      request: { query: xhsOpsRunListQuerySchema },
      responses: {
        200: {
          content: {
            "application/json": { schema: xhsOpsRunListResponseSchema },
          },
          description: "Runs, newest first",
        },
      },
    }),
    async (c) =>
      c.json({ runs: await store.listRuns(c.req.valid("query")) }, 200),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/xhs-ops/runs",
      tags: TAGS,
      request: {
        body: {
          content: { "application/json": { schema: xhsOpsRunCreateSchema } },
        },
      },
      responses: {
        200: {
          content: { "application/json": { schema: xhsOpsRunResponseSchema } },
          description: "Planned run (status planned)",
        },
        400: jsonError("Account has no device bound"),
        404: jsonError("Project or account not found"),
        409: jsonError("Conflict"),
        500: jsonError("Internal error"),
      },
    }),
    async (c) => {
      try {
        const run = await runService.createRun(c.req.valid("json"));
        return c.json({ run }, 200);
      } catch (err) {
        const mapped = mapError(err);
        return c.json({ message: mapped.message }, mapped.status);
      }
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/xhs-ops/runs/{runId}",
      tags: TAGS,
      request: { params: runIdParamSchema },
      responses: {
        200: {
          content: { "application/json": { schema: xhsOpsRunResponseSchema } },
          description: "Run",
        },
        404: jsonError("Run not found"),
      },
    }),
    async (c) => {
      const run = await store.getRun(c.req.valid("param").runId);
      if (!run) return c.json({ message: "运行记录不存在" }, 404);
      return c.json({ run }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "patch",
      path: "/api/v1/xhs-ops/runs/{runId}",
      tags: TAGS,
      request: {
        params: runIdParamSchema,
        body: {
          content: { "application/json": { schema: xhsOpsRunUpdateSchema } },
        },
      },
      responses: {
        200: {
          content: { "application/json": { schema: xhsOpsRunResponseSchema } },
          description: "Run with updated notes",
        },
        404: jsonError("Run not found"),
      },
    }),
    async (c) => {
      const { notes } = c.req.valid("json");
      const run = await store.updateRun(
        c.req.valid("param").runId,
        (current) => (notes === undefined ? current : { ...current, notes }),
      );
      if (!run) return c.json({ message: "运行记录不存在" }, 404);
      return c.json({ run }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/xhs-ops/runs/{runId}/start",
      tags: TAGS,
      request: { params: runIdParamSchema },
      responses: {
        200: {
          content: { "application/json": { schema: xhsOpsRunResponseSchema } },
          description: "Run started (status running); executes asynchronously",
        },
        400: jsonError("Bad request"),
        404: jsonError("Run not found"),
        409: jsonError("Run is already running or finished"),
        500: jsonError("Internal error"),
      },
    }),
    async (c) => {
      try {
        const run = await runService.startRun(c.req.valid("param").runId);
        return c.json({ run }, 200);
      } catch (err) {
        const mapped = mapError(err);
        return c.json({ message: mapped.message }, mapped.status);
      }
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/xhs-ops/runs/{runId}/cancel",
      tags: TAGS,
      request: { params: runIdParamSchema },
      responses: {
        200: {
          content: { "application/json": { schema: xhsOpsRunResponseSchema } },
          description: "Run cancelled; the phone's current task is cancelled",
        },
        400: jsonError("Bad request"),
        404: jsonError("Run not found"),
        409: jsonError("Run is not running"),
        500: jsonError("Internal error"),
      },
    }),
    async (c) => {
      try {
        const run = await runService.cancelRun(c.req.valid("param").runId);
        return c.json({ run }, 200);
      } catch (err) {
        const mapped = mapError(err);
        return c.json({ message: mapped.message }, mapped.status);
      }
    },
  );
}
