import { type OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { isSkillUpdateAvailable } from "@nexu/shared";
import type { ControllerContainer } from "../app/container.js";
import {
  SkillInstallConflictError,
  SkillUpdateNotAllowedError,
} from "../services/skillhub-service.js";
import { CatalogRevisionChangedError } from "../services/skillhub/catalog-manager.js";
import type { ControllerBindings } from "../types.js";

const DEFAULT_DOWNLOAD_COUNT = 1000;

const minimalSkillSchema = z.object({
  identity: z.string().optional(),
  ownerHandle: z.string().optional(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  downloads: z.number(),
  stars: z.number(),
  tags: z.array(z.string()),
  version: z.string(),
  updatedAt: z.string(),
});

const installedSkillSchema = z.object({
  slug: z.string(),
  ownerHandle: z.string().nullable(),
  version: z.string().nullable(),
  source: z.enum(["managed", "custom", "workspace", "user"]),
  name: z.string(),
  description: z.string(),
  installedAt: z.string().nullable(),
  agentId: z.string().nullable(),
  agentName: z.string().nullable(),
});

const catalogMetaSchema = z.object({
  version: z.string(),
  updatedAt: z.string(),
  skillCount: z.number(),
});

const queueItemSchema = z.object({
  slug: z.string(),
  ownerHandle: z.string().nullable(),
  source: z.enum(["managed", "custom", "workspace", "user"]),
  status: z.enum([
    "queued",
    "downloading",
    "installing-deps",
    "done",
    "failed",
  ]),
  position: z.number(),
  error: z.string().nullable(),
  errorCode: z
    .enum([
      "skill_not_found",
      "rate_limit",
      "npm_missing",
      "deps_install_failed",
      "unknown",
    ])
    .nullable(),
  retries: z.number(),
  enqueuedAt: z.string(),
});

const skillhubCatalogResponseSchema = z.object({
  skills: z.array(minimalSkillSchema),
  installedSlugs: z.array(z.string()),
  installedSkills: z.array(installedSkillSchema),
  meta: catalogMetaSchema.nullable(),
  queue: z.array(queueItemSchema),
});

const skillhubStatusResponseSchema = skillhubCatalogResponseSchema.omit({
  skills: true,
  meta: true,
});

const skillhubCatalogPageQuerySchema = z.object({
  q: z.string().max(100).optional(),
  category: z.string().max(80).optional(),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(48),
  sort: z.enum(["downloads", "updated", "stars"]).default("downloads"),
});

const skillhubCatalogPageResponseSchema = skillhubCatalogResponseSchema.extend({
  nextCursor: z.string().nullable(),
  total: z.number(),
  facets: z.array(z.object({ tag: z.string(), count: z.number() })),
});

const skillhubCatalogPageErrorSchema = z.object({
  error: z.string(),
  code: z.literal("catalog_revision_changed"),
});

const skillhubMutationResultSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
});

const skillhubSlugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,127}$/);
const skillhubSourceSchema = z.enum(["managed", "custom", "workspace", "user"]);
const skillhubUninstallRequestSchema = z
  .object({
    slug: skillhubSlugSchema,
    source: skillhubSourceSchema.optional(),
    agentId: z.string().nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.source === "workspace" && !value.agentId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["agentId"],
        message: "agentId is required for workspace uninstall",
      });
    }
  });

const skillhubInstallRequestSchema = z.object({
  slug: skillhubSlugSchema,
  ownerHandle: z
    .string()
    .regex(/^@?[a-z0-9][a-z0-9._-]{0,127}$/)
    .optional(),
  version: z.string().min(1).max(100).optional(),
  update: z.boolean().optional(),
});

const skillhubInstallResultSchema = z.object({
  ok: z.boolean(),
  queued: z.boolean().optional(),
  slug: z.string().optional(),
  status: z
    .enum(["queued", "downloading", "installing-deps", "done", "failed"])
    .optional(),
  position: z.number().optional(),
  error: z.string().optional(),
});
const skillhubRefreshResultSchema = z.object({
  ok: z.boolean(),
  skillCount: z.number(),
  error: z.string().optional(),
});
const skillhubDetailResponseSchema = z.object({
  ownerHandle: z.string().optional(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  downloads: z.number(),
  stars: z.number(),
  tags: z.array(z.string()),
  version: z.string(),
  installedVersion: z.string().nullable(),
  updateEligible: z.boolean(),
  updatedAt: z.string(),
  installed: z.boolean(),
  installedSource: skillhubSourceSchema.nullable(),
  agentId: z.string().nullable(),
  uninstallable: z.boolean(),
  skillContent: z.string().nullable(),
  files: z.array(z.string()),
});

const skillhubImportResultSchema = z.object({
  ok: z.boolean(),
  slug: z.string().optional(),
  error: z.string().optional(),
  errorCode: z
    .enum([
      "skill_not_found",
      "rate_limit",
      "npm_missing",
      "deps_install_failed",
      "unknown",
    ])
    .optional(),
});

export function registerSkillhubRoutes(
  app: OpenAPIHono<ControllerBindings>,
  container: ControllerContainer,
): void {
  // GET /api/v1/skillhub/catalog
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/skillhub/catalog",
      tags: ["SkillHub"],
      responses: {
        200: {
          content: {
            "application/json": { schema: skillhubCatalogResponseSchema },
          },
          description: "SkillHub catalog",
        },
      },
    }),
    async (c) => {
      const catalog = await container.skillhubService.catalog.getCatalogPage({
        limit: 100,
        sort: "downloads",
      });
      const queue = [...container.skillhubService.queue.getQueue()];
      const bots = await container.configStore.listBots();
      const botNameMap = new Map(bots.map((b) => [b.id, b.name]));

      const installedSkills = catalog.installedSkills.map((skill) => ({
        ...skill,
        agentName: skill.agentId
          ? (botNameMap.get(skill.agentId) ?? null)
          : null,
      }));

      return c.json(
        {
          skills: catalog.skills,
          installedSlugs: catalog.installedSlugs,
          installedSkills,
          meta: catalog.meta,
          queue,
        },
        200,
      );
    },
  );

  // GET /api/v1/skillhub/status
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/skillhub/status",
      tags: ["SkillHub"],
      responses: {
        200: {
          content: {
            "application/json": { schema: skillhubStatusResponseSchema },
          },
          description: "Installed skills and install queue status",
        },
      },
    }),
    async (c) => {
      const catalog = container.skillhubService.catalog.getInstalledState();
      const queue = [...container.skillhubService.queue.getQueue()];
      const bots = await container.configStore.listBots();
      const botNameMap = new Map(bots.map((bot) => [bot.id, bot.name]));
      const installedSkills = catalog.installedSkills.map((skill) => ({
        ...skill,
        agentName: skill.agentId
          ? (botNameMap.get(skill.agentId) ?? null)
          : null,
      }));
      return c.json(
        {
          installedSlugs: catalog.installedSlugs,
          installedSkills,
          queue,
        },
        200,
      );
    },
  );

  // GET /api/v1/skillhub/catalog-page
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/skillhub/catalog-page",
      tags: ["SkillHub"],
      request: { query: skillhubCatalogPageQuerySchema },
      responses: {
        200: {
          content: {
            "application/json": { schema: skillhubCatalogPageResponseSchema },
          },
          description: "Paginated SkillHub catalog",
        },
        409: {
          content: {
            "application/json": { schema: skillhubCatalogPageErrorSchema },
          },
          description: "Catalog revision changed during pagination",
        },
      },
    }),
    async (c) => {
      const query = c.req.valid("query");
      let catalog: Awaited<
        ReturnType<typeof container.skillhubService.catalog.getCatalogPage>
      >;
      try {
        catalog = await container.skillhubService.catalog.getCatalogPage({
          query: query.q,
          category: query.category,
          cursor: query.cursor,
          limit: query.limit,
          sort: query.sort,
        });
      } catch (error) {
        if (error instanceof CatalogRevisionChangedError) {
          return c.json(
            {
              error: error.message,
              code: "catalog_revision_changed" as const,
            },
            409,
          );
        }
        throw error;
      }
      const queue = [...container.skillhubService.queue.getQueue()];
      const bots = await container.configStore.listBots();
      const botNameMap = new Map(bots.map((bot) => [bot.id, bot.name]));
      const installedSkills = catalog.installedSkills.map((skill) => ({
        ...skill,
        agentName: skill.agentId
          ? (botNameMap.get(skill.agentId) ?? null)
          : null,
      }));
      return c.json({ ...catalog, installedSkills, queue }, 200);
    },
  );

  // POST /api/v1/skillhub/install
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/skillhub/install",
      tags: ["SkillHub"],
      request: {
        body: {
          content: {
            "application/json": {
              schema: skillhubInstallRequestSchema,
            },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: skillhubInstallResultSchema },
          },
          description: "Install",
        },
        409: {
          content: {
            "application/json": { schema: skillhubInstallResultSchema },
          },
          description: "Install conflict or update not allowed",
        },
      },
    }),
    async (c) => {
      const request = c.req.valid("json");
      try {
        const queueItem = container.skillhubService.enqueueInstall(request);
        return c.json(
          {
            ok: true,
            queued: true,
            slug: queueItem.slug,
            status: queueItem.status,
            position: queueItem.position,
          },
          200,
        );
      } catch (error) {
        if (
          error instanceof SkillInstallConflictError ||
          error instanceof SkillUpdateNotAllowedError
        ) {
          return c.json({ ok: false, error: error.message }, 409);
        }
        throw error;
      }
    },
  );

  // POST /api/v1/skillhub/uninstall
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/skillhub/uninstall",
      tags: ["SkillHub"],
      request: {
        body: {
          content: {
            "application/json": {
              schema: skillhubUninstallRequestSchema,
            },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: skillhubMutationResultSchema },
          },
          description: "Uninstall",
        },
      },
    }),
    async (c) => {
      const request = c.req.valid("json");
      const result = await container.skillhubService.uninstallSkill(request);
      if (result.ok) {
        await container.openclawSyncService.syncAll();
      }
      return c.json(result, 200);
    },
  );

  // POST /api/v1/skillhub/cancel
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/skillhub/cancel",
      tags: ["SkillHub"],
      request: {
        body: {
          content: {
            "application/json": {
              schema: z.object({ slug: skillhubSlugSchema }),
            },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": {
              schema: z.object({
                ok: z.boolean(),
                cancelled: z.boolean(),
              }),
            },
          },
          description: "Cancel or dismiss a queued / failed install",
        },
      },
    }),
    async (c) => {
      const { slug } = c.req.valid("json");
      const cancelled = container.skillhubService.cancelInstall(slug);
      return c.json({ ok: true, cancelled }, 200);
    },
  );

  // POST /api/v1/skillhub/refresh
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/skillhub/refresh",
      tags: ["SkillHub"],
      responses: {
        200: {
          content: {
            "application/json": { schema: skillhubRefreshResultSchema },
          },
          description: "Refresh",
        },
      },
    }),
    async (c) => {
      const result = await container.skillhubService.catalog.refreshCatalog();
      return c.json(result, 200);
    },
  );

  // GET /api/v1/skillhub/skills/{slug}
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/skillhub/skills/{slug}",
      tags: ["SkillHub"],
      request: {
        params: z.object({ slug: skillhubSlugSchema }),
        query: z
          .object({
            source: skillhubSourceSchema.optional(),
            agentId: z.string().optional(),
            ownerHandle: z
              .string()
              .regex(/^@?[a-z0-9][a-z0-9._-]{0,127}$/)
              .optional(),
          })
          .superRefine((value, ctx) => {
            if (value.source === "workspace" && !value.agentId) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["agentId"],
                message: "agentId is required for workspace skill detail",
              });
            }
          }),
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: skillhubDetailResponseSchema },
          },
          description: "Skill detail",
        },
        404: {
          content: {
            "application/json": { schema: z.object({ message: z.string() }) },
          },
          description: "Not found",
        },
      },
    }),
    async (c) => {
      const { slug } = c.req.valid("param");
      const query = c.req.valid("query");
      const catalog = container.skillhubService.catalog.getInstalledState();
      const catalogSkill =
        await container.skillhubService.catalog.getCatalogSkill(
          slug,
          query.ownerHandle,
        );
      const normalizedOwnerHandle = query.ownerHandle
        ?.replace(/^@+/, "")
        .toLowerCase();
      const matchingInstalledSkills = catalog.installedSkills.filter(
        (skill) =>
          skill.slug === slug &&
          (!normalizedOwnerHandle ||
            skill.ownerHandle?.replace(/^@+/, "").toLowerCase() ===
              normalizedOwnerHandle),
      );
      const installedSkill = query.source
        ? matchingInstalledSkills.find(
            (skill) =>
              skill.source === query.source &&
              (query.source !== "workspace" || skill.agentId === query.agentId),
          )
        : matchingInstalledSkills.length === 1
          ? matchingInstalledSkills[0]
          : matchingInstalledSkills.find(
              (skill) => skill.source !== "workspace",
            );
      const installed =
        query.source || matchingInstalledSkills.length <= 1
          ? Boolean(installedSkill)
          : matchingInstalledSkills.length > 0;

      if (!catalogSkill && !installedSkill) {
        return c.json({ message: "Skill not found" }, 404);
      }

      const isCustom = installedSkill?.source === "custom";
      const rawDownloads = catalogSkill?.downloads ?? 0;
      const downloads = isCustom
        ? 0
        : rawDownloads > 0
          ? rawDownloads
          : DEFAULT_DOWNLOAD_COUNT;

      return c.json(
        {
          slug,
          ...(catalogSkill?.ownerHandle || installedSkill?.ownerHandle
            ? {
                ownerHandle:
                  catalogSkill?.ownerHandle ??
                  installedSkill?.ownerHandle ??
                  undefined,
              }
            : {}),
          name: catalogSkill?.name ?? installedSkill?.name ?? slug,
          description:
            catalogSkill?.description ?? installedSkill?.description ?? "",
          downloads,
          stars: catalogSkill?.stars ?? 0,
          tags: catalogSkill?.tags ?? [],
          version: catalogSkill?.version ?? installedSkill?.version ?? "1.0.0",
          installedVersion: installedSkill?.version ?? null,
          updateEligible: Boolean(
            installedSkill?.source === "managed" &&
              installedSkill.ownerHandle &&
              catalogSkill?.ownerHandle &&
              installedSkill.ownerHandle.replace(/^@+/, "").toLowerCase() ===
                catalogSkill.ownerHandle.replace(/^@+/, "").toLowerCase() &&
              isSkillUpdateAvailable(
                catalogSkill.version,
                installedSkill.version ?? undefined,
              ),
          ),
          updatedAt: catalogSkill?.updatedAt ?? new Date().toISOString(),
          installed,
          installedSource: installedSkill?.source ?? null,
          agentId: installedSkill?.agentId ?? null,
          uninstallable: Boolean(
            installedSkill &&
              (installedSkill.source !== "workspace" || installedSkill.agentId),
          ),
          skillContent: null,
          files: [],
        },
        200,
      );
    },
  );

  // POST /api/v1/skillhub/import
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/skillhub/import",
      tags: ["SkillHub"],
      request: {
        body: {
          content: {
            "multipart/form-data": {
              schema: z.object({
                file: z.instanceof(File),
              }),
            },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: skillhubImportResultSchema },
          },
          description: "Import result",
        },
        400: {
          content: {
            "application/json": { schema: skillhubImportResultSchema },
          },
          description: "Import rejected or failed",
        },
      },
    }),
    async (c) => {
      const body = await c.req.parseBody();
      const file = body.file;

      if (!(file instanceof File)) {
        return c.json(
          { ok: false as const, error: "No zip file provided" },
          400,
        );
      }

      if (!file.name.endsWith(".zip")) {
        return c.json(
          { ok: false as const, error: "Only .zip files are accepted" },
          400,
        );
      }

      const maxSize = 50 * 1024 * 1024; // 50 MB
      if (file.size > maxSize) {
        return c.json(
          { ok: false as const, error: "Zip file too large (max 50 MB)" },
          400,
        );
      }

      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const result =
        await container.skillhubService.catalog.importSkillZip(buffer);

      if (!result.ok) {
        // Dependency-install failures, path-safety violations, etc.
        // Structured payload (error + errorCode) lets the UI render
        // retryable vs unrecoverable states without a generic 500.
        return c.json(result, 400);
      }

      await container.openclawSyncService.syncAll();
      return c.json(result, 200);
    },
  );
}
