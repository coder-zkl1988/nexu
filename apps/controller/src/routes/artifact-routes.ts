import { type OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  artifactListResponseSchema,
  artifactResponseSchema,
  artifactStatsResponseSchema,
  createArtifactSchema,
  updateArtifactSchema,
} from "@nexu/shared";
import type { ControllerContainer } from "../app/container.js";
import {
  discoverLocalWebPreviews,
  localWebPreviewAssetPathFromUrl,
  readLocalWebPreviewFile,
} from "../services/local-web-preview.js";
import type { ControllerBindings } from "../types.js";

const querySchema = z.object({
  limit: z.coerce.number().int().positive().default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
  sessionKey: z.string().optional(),
});

const artifactIdParamSchema = z.object({ id: z.string() });
const artifactNotFoundSchema = z.object({ message: z.string() });
const localPreviewParamSchema = z.object({
  botId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/),
  encodedRoot: z.string().regex(/^[A-Za-z0-9_-]+$/),
});
const localPreviewFileSchema = z.string().openapi({ format: "binary" });

export function registerArtifactRoutes(
  app: OpenAPIHono<ControllerBindings>,
  container: ControllerContainer,
): void {
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/internal/artifacts",
      tags: ["Artifacts", "Internal"],
      request: {
        body: {
          content: { "application/json": { schema: createArtifactSchema } },
        },
      },
      responses: {
        201: {
          content: { "application/json": { schema: artifactResponseSchema } },
          description: "Created artifact",
        },
      },
    }),
    async (c) =>
      c.json(
        await container.artifactService.createArtifact(c.req.valid("json")),
        201,
      ),
  );

  // Binary workspace assets are loaded by the sandboxed browser iframe, not
  // by the generated frontend SDK. The decoded root and requested file are
  // both constrained to the selected Bot workspace by readLocalWebPreviewFile.
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/artifacts/local-preview/{botId}/{encodedRoot}/*",
      operationId: "getLocalWebPreviewAsset",
      tags: ["Artifacts"],
      request: { params: localPreviewParamSchema },
      responses: {
        200: {
          content: {
            "application/octet-stream": { schema: localPreviewFileSchema },
          },
          description: "Local preview asset",
        },
        404: {
          content: { "text/plain": { schema: z.string() } },
          description: "Local preview asset not found",
        },
      },
    }),
    async (c) => {
      const { botId, encodedRoot } = c.req.valid("param");
      const assetPath = localWebPreviewAssetPathFromUrl({
        requestUrl: c.req.url,
        botId,
        encodedRoot,
      });
      if (assetPath === null) return c.text("Not found", 404);

      const file = await readLocalWebPreviewFile({
        openclawStateDir: container.env.openclawStateDir,
        botId,
        encodedRoot,
        assetPath,
      });
      if (!file) return c.text("Not found", 404);

      // These files are agent-written and served from the control plane's own
      // origin, so a script in them is otherwise a same-origin caller of the
      // control plane and can start an agent run. Scope `connect-src` to the
      // preview subtree instead of denying it outright: generated pages
      // routinely fetch their own data files, and `'self'` would put the whole
      // API back in reach. Falls back to `'none'` when the host header is
      // unusable — a preview that cannot fetch beats one that can POST to
      // /api/v1/chat. A document-level `sandbox` is the wrong tool here: it
      // would put the page in an opaque origin and its own subresource loads
      // would then be rejected by the loopback guard as cross-site.
      const previewHost = c.req.header("host");
      const connectSrc =
        previewHost && /^[\w.-]+(:\d+)?$/.test(previewHost)
          ? `http://${previewHost}/api/v1/artifacts/local-preview/`
          : "'none'";

      return c.body(file.data, 200, {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
        "Content-Security-Policy": `connect-src ${connectSrc}; form-action 'none'; base-uri 'none'`,
        "Content-Type": file.contentType,
        "X-Content-Type-Options": "nosniff",
      });
    },
  );

  app.openapi(
    createRoute({
      method: "patch",
      path: "/api/internal/artifacts/{id}",
      tags: ["Artifacts", "Internal"],
      request: {
        params: artifactIdParamSchema,
        body: {
          content: { "application/json": { schema: updateArtifactSchema } },
        },
      },
      responses: {
        200: {
          content: { "application/json": { schema: artifactResponseSchema } },
          description: "Updated artifact",
        },
        404: {
          content: { "application/json": { schema: artifactNotFoundSchema } },
          description: "Artifact not found",
        },
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const artifact = await container.artifactService.updateArtifact(
        id,
        c.req.valid("json"),
      );
      if (artifact === null) {
        return c.json({ message: "Artifact not found" }, 404);
      }
      return c.json(artifact, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/artifacts",
      tags: ["Artifacts"],
      request: { query: querySchema },
      responses: {
        200: {
          content: {
            "application/json": { schema: artifactListResponseSchema },
          },
          description: "Artifacts",
        },
      },
    }),
    async (c) => {
      const query = c.req.valid("query");
      const listed = await container.artifactService.listArtifacts(query);
      if (!query.sessionKey || query.offset > 0) {
        return c.json(listed, 200);
      }

      const localPreviews = await discoverLocalWebPreviews({
        openclawStateDir: container.env.openclawStateDir,
        sessionKey: query.sessionKey,
        requestOrigin: new URL(c.req.url).origin,
      });
      const storedPreviewUrls = new Set(
        listed.artifacts.map((artifact) => artifact.previewUrl).filter(Boolean),
      );
      const uniqueLocalPreviews = localPreviews.filter(
        (preview) => !storedPreviewUrls.has(preview.previewUrl),
      );

      return c.json(
        {
          ...listed,
          artifacts: [...uniqueLocalPreviews, ...listed.artifacts].slice(
            0,
            query.limit,
          ),
          total: listed.total + uniqueLocalPreviews.length,
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/artifacts/stats",
      tags: ["Artifacts"],
      responses: {
        200: {
          content: {
            "application/json": { schema: artifactStatsResponseSchema },
          },
          description: "Artifact stats",
        },
      },
    }),
    async (c) => c.json(await container.artifactService.getStats(), 200),
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/artifacts/{id}",
      tags: ["Artifacts"],
      request: { params: artifactIdParamSchema },
      responses: {
        200: {
          content: { "application/json": { schema: artifactResponseSchema } },
          description: "Artifact",
        },
        404: {
          content: { "application/json": { schema: artifactNotFoundSchema } },
          description: "Artifact not found",
        },
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const artifact = await container.artifactService.getArtifact(id);
      if (artifact === null) {
        return c.json({ message: "Artifact not found" }, 404);
      }
      return c.json(artifact, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/api/v1/artifacts/{id}",
      tags: ["Artifacts"],
      request: { params: artifactIdParamSchema },
      responses: {
        200: {
          content: {
            "application/json": { schema: z.object({ ok: z.boolean() }) },
          },
          description: "Deleted artifact",
        },
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      return c.json(
        { ok: await container.artifactService.deleteArtifact(id) },
        200,
      );
    },
  );
}
