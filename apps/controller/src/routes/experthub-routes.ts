import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  createCustomExpertRequestSchema,
  createCustomExpertResponseSchema,
  expertManifestSchema,
  experthubCatalogResponseSchema,
  installExpertRequestSchema,
  installExpertResponseSchema,
  uninstallExpertRequestSchema,
  uninstallExpertResponseSchema,
} from "@nexu/shared";
import type { ExperthubCatalogManager } from "../services/experthub/catalog-manager.js";
import {
  ExpertNotFoundError,
  type InstallExpertResult,
} from "../services/experthub/install-flow.js";

/**
 * Narrow injected dependency surface for the experthub HTTP routes. The
 * routes treat the catalog as a generic read/write adapter and the install
 * flow as a single function, which keeps this factory trivially unit-testable
 * with plain mocks (no container needed) and decouples the routes from the
 * concrete Task 7 DI wiring.
 */
export type ExperthubRoutesDeps = {
  catalog: Pick<
    ExperthubCatalogManager,
    | "listExperts"
    | "resolveExpert"
    | "refresh"
    | "getMeta"
    | "readLedger"
    | "writeLedger"
  >;
  installExpert: (args: { slug: string }) => Promise<InstallExpertResult>;
  createCustomExpert: (args: {
    name: string;
    avatarDataUrl?: string;
    modelId: string;
    description?: string;
    skills: string[];
    existingSlug?: string;
    workspaceFiles: Record<string, string>;
  }) => Promise<{ ok: true; botId: string; slug: string }>;
};

const notFoundErrorSchema = z.object({ message: z.string() });

const refreshResponseSchema = z.object({
  meta: z
    .object({
      version: z.string(),
      updatedAt: z.string(),
      count: z.number(),
    })
    .nullable(),
});

/**
 * Build a mountable OpenAPIHono router for ExpertHub. Task 7 is responsible
 * for constructing the concrete deps in the controller container and
 * mounting this router at `/api/v1/experthub` onto the root app.
 */
export function buildExperthubRoutes(deps: ExperthubRoutesDeps) {
  const app = new OpenAPIHono();

  // GET /catalog
  app.openapi(
    createRoute({
      method: "get",
      path: "/catalog",
      tags: ["ExpertHub"],
      responses: {
        200: {
          content: {
            "application/json": { schema: experthubCatalogResponseSchema },
          },
          description: "Catalog of experts (bundled + managed) with ledger",
        },
      },
    }),
    async (c) => {
      const [experts, ledger, meta] = await Promise.all([
        deps.catalog.listExperts(),
        deps.catalog.readLedger(),
        deps.catalog.getMeta(),
      ]);
      const installedExperts = Object.values(ledger.entries);
      const installedSlugs = installedExperts.map((entry) => entry.slug);
      return c.json(
        {
          experts,
          installedSlugs,
          installedExperts,
          meta,
        },
        200,
      );
    },
  );

  // POST /install
  app.openapi(
    createRoute({
      method: "post",
      path: "/install",
      tags: ["ExpertHub"],
      request: {
        body: {
          content: {
            "application/json": { schema: installExpertRequestSchema },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: installExpertResponseSchema },
          },
          description: "Expert installed",
        },
        404: {
          content: {
            "application/json": { schema: notFoundErrorSchema },
          },
          description: "Expert not found",
        },
      },
    }),
    async (c) => {
      const { slug } = c.req.valid("json");
      try {
        const result = await deps.installExpert({ slug });
        return c.json(result, 200);
      } catch (error) {
        if (error instanceof ExpertNotFoundError) {
          return c.json({ message: error.message }, 404);
        }
        throw error;
      }
    },
  );

  // POST /uninstall
  app.openapi(
    createRoute({
      method: "post",
      path: "/uninstall",
      tags: ["ExpertHub"],
      request: {
        body: {
          content: {
            "application/json": { schema: uninstallExpertRequestSchema },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: uninstallExpertResponseSchema },
          },
          description: "Expert uninstalled (ledger entry removed)",
        },
      },
    }),
    async (c) => {
      const { slug } = c.req.valid("json");
      const ledger = await deps.catalog.readLedger();
      if (ledger.entries[slug]) {
        delete ledger.entries[slug];
        ledger.updatedAt = new Date().toISOString();
        await deps.catalog.writeLedger(ledger);
      }
      // Per plan spec: do NOT delete the bot — user may have customized it
      // after install, and deletion is handled via the bots UI explicitly.
      return c.json({ ok: true as const }, 200);
    },
  );

  // POST /refresh
  app.openapi(
    createRoute({
      method: "post",
      path: "/refresh",
      tags: ["ExpertHub"],
      responses: {
        200: {
          content: {
            "application/json": { schema: refreshResponseSchema },
          },
          description: "Remote catalog refreshed",
        },
      },
    }),
    async (c) => {
      const meta = await deps.catalog.refresh();
      return c.json({ meta }, 200);
    },
  );

  // GET /experts/{slug}
  app.openapi(
    createRoute({
      method: "get",
      path: "/experts/{slug}",
      tags: ["ExpertHub"],
      request: {
        params: z.object({ slug: z.string().min(1) }),
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: expertManifestSchema },
          },
          description: "Full expert manifest",
        },
        404: {
          content: {
            "application/json": { schema: notFoundErrorSchema },
          },
          description: "Expert not found",
        },
      },
    }),
    async (c) => {
      const { slug } = c.req.valid("param");
      const resolved = await deps.catalog.resolveExpert(slug);
      if (!resolved) {
        return c.json({ message: "Expert not found" }, 404);
      }
      return c.json(resolved.manifest, 200);
    },
  );

  // POST /custom
  app.openapi(
    createRoute({
      method: "post",
      path: "/custom",
      tags: ["ExpertHub"],
      request: {
        body: {
          content: {
            "application/json": { schema: createCustomExpertRequestSchema },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: createCustomExpertResponseSchema },
          },
          description: "Custom expert created",
        },
      },
    }),
    async (c) => {
      const body = c.req.valid("json");
      const result = await deps.createCustomExpert({
        name: body.name,
        avatarDataUrl: body.avatarDataUrl,
        modelId: body.modelId,
        description: body.description,
        skills: body.skills,
        existingSlug: body.existingSlug,
        workspaceFiles: body.workspaceFiles as Record<string, string>,
      });
      return c.json(result, 200);
    },
  );

  return app;
}
