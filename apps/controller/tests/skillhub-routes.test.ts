import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it, vi } from "vitest";
import type { ControllerContainer } from "../src/app/container.js";
import { registerSkillhubRoutes } from "../src/routes/skillhub-routes.js";
import { SkillUpdateNotAllowedError } from "../src/services/skillhub-service.js";
import { CatalogRevisionChangedError } from "../src/services/skillhub/catalog-manager.js";
import type { ControllerBindings } from "../src/types.js";

const catalogSkill = {
  slug: "weather",
  ownerHandle: "publisher",
  name: "Weather",
  description: "Weather forecasts",
  downloads: 42,
  stars: 7,
  tags: ["productivity"],
  version: "2.0.0",
  updatedAt: "2026-07-29T00:00:00.000Z",
};

function createSkillhubApp(options?: {
  installedOwnerHandle?: string | null;
  enqueueInstall?: ReturnType<typeof vi.fn>;
  getCatalogPage?: ReturnType<typeof vi.fn>;
}) {
  const installedSkills =
    options && "installedOwnerHandle" in options
      ? [
          {
            slug: "weather",
            ownerHandle: options.installedOwnerHandle ?? null,
            version: "1.0.0",
            source: "managed" as const,
            name: "Weather",
            description: "Installed weather skill",
            installedAt: "2026-07-28T00:00:00.000Z",
            agentId: null,
          },
        ]
      : [];
  const enqueueInstall =
    options?.enqueueInstall ??
    vi.fn(() => ({
      slug: "weather",
      status: "queued",
      position: 0,
    }));
  const getCatalogSkill = vi.fn(async () => catalogSkill);
  const getCatalogPage =
    options?.getCatalogPage ??
    vi.fn(async () => ({
      skills: [catalogSkill],
      installedSlugs: installedSkills.map((skill) => skill.slug),
      installedSkills,
      meta: null,
      nextCursor: null,
      total: 1,
      facets: [],
    }));
  const app = new OpenAPIHono<ControllerBindings>();
  registerSkillhubRoutes(app, {
    skillhubService: {
      catalog: {
        getCatalog: () => ({
          skills: [catalogSkill],
          installedSlugs: installedSkills.map((skill) => skill.slug),
          installedSkills,
          meta: null,
        }),
        getCatalogPage,
        getInstalledState: () => ({
          installedSlugs: installedSkills.map((skill) => skill.slug),
          installedSkills,
        }),
        getCatalogSkill,
        refreshCatalog: vi.fn(),
        importSkillZip: vi.fn(),
      },
      queue: { getQueue: () => [] },
      enqueueInstall,
      uninstallSkill: vi.fn(),
      cancelInstall: vi.fn(),
      installWorkspaceSkill: vi.fn(),
    },
    configStore: { listBots: vi.fn(async () => []) },
    openclawSyncService: { syncAll: vi.fn() },
  } as unknown as ControllerContainer);
  return { app, enqueueInstall, getCatalogPage, getCatalogSkill };
}

describe("SkillHub routes", () => {
  it("serves the legacy catalog from a bounded server page", async () => {
    const { app, getCatalogPage } = createSkillhubApp();

    const response = await app.request("/api/v1/skillhub/catalog");

    expect(response.status).toBe(200);
    expect(getCatalogPage).toHaveBeenCalledWith({
      limit: 100,
      sort: "downloads",
    });
    await expect(response.json()).resolves.toMatchObject({
      skills: [catalogSkill],
      installedSlugs: [],
    });
  });

  it("forwards an owner-scoped update request", async () => {
    const { app, enqueueInstall } = createSkillhubApp();

    const response = await app.request("/api/v1/skillhub/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        slug: "weather",
        ownerHandle: "publisher",
        version: "2.0.0",
        update: true,
      }),
    });

    expect(response.status).toBe(200);
    expect(enqueueInstall).toHaveBeenCalledWith({
      slug: "weather",
      ownerHandle: "publisher",
      version: "2.0.0",
      update: true,
    });
  });

  it("returns a structured conflict when the catalog revision changes", async () => {
    const getCatalogPage = vi.fn(async () => {
      throw new CatalogRevisionChangedError();
    });
    const { app } = createSkillhubApp({ getCatalogPage });

    const response = await app.request(
      "/api/v1/skillhub/catalog-page?cursor=stale-cursor",
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Catalog revision changed; restart pagination",
      code: "catalog_revision_changed",
    });
  });

  it("returns 409 when the service rejects an update", async () => {
    const enqueueInstall = vi.fn(() => {
      throw new SkillUpdateNotAllowedError("weather");
    });
    const { app } = createSkillhubApp({ enqueueInstall });

    const response = await app.request("/api/v1/skillhub/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        slug: "weather",
        ownerHandle: "publisher",
        version: "2.0.0",
        update: true,
      }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Skill update is not allowed for weather",
    });
  });

  it("does not match an ownerless legacy install to an owner-scoped detail", async () => {
    const { app } = createSkillhubApp({ installedOwnerHandle: null });

    const response = await app.request(
      "/api/v1/skillhub/skills/weather?ownerHandle=publisher",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      installed: false,
      installedVersion: null,
      updateEligible: false,
      uninstallable: false,
    });
  });

  it("reports an update only for the exact installed publisher", async () => {
    const { app, getCatalogSkill } = createSkillhubApp({
      installedOwnerHandle: "@Publisher",
    });

    const response = await app.request(
      "/api/v1/skillhub/skills/weather?ownerHandle=@publisher",
    );

    expect(response.status).toBe(200);
    expect(getCatalogSkill).toHaveBeenCalledWith("weather", "@publisher");
    await expect(response.json()).resolves.toMatchObject({
      installed: true,
      installedVersion: "1.0.0",
      updateEligible: true,
      uninstallable: true,
    });
  });
});
