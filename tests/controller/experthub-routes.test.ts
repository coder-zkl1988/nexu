import type { ExpertManifest } from "@nexu/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ExperthubRoutesDeps,
  buildExperthubRoutes,
} from "../../apps/controller/src/routes/experthub-routes.js";
import { ExpertNotFoundError } from "../../apps/controller/src/services/experthub/install-flow.js";

const manifest: ExpertManifest = {
  schemaVersion: 1,
  slug: "code-reviewer",
  name: "Code Reviewer",
  emoji: "🔍",
  category: "coding",
  description: "Reviews code.",
  tags: [],
  version: "1.0.0",
  author: "Nexu",
  systemPrompt: "You review code.",
  modelId: "gpt-4o",
  requiredSkills: [],
  workspaceFiles: {},
};

type CatalogMock = ExperthubRoutesDeps["catalog"];

function buildCatalog(overrides: Partial<CatalogMock> = {}): CatalogMock {
  return {
    listExperts: vi.fn().mockResolvedValue([
      {
        slug: manifest.slug,
        name: manifest.name,
        emoji: manifest.emoji,
        category: manifest.category,
        description: manifest.description,
        tags: manifest.tags,
        version: manifest.version,
        author: manifest.author,
      },
    ]),
    resolveExpert: vi.fn().mockResolvedValue(null),
    refresh: vi.fn().mockResolvedValue(null),
    getMeta: vi.fn().mockResolvedValue(null),
    readLedger: vi
      .fn()
      .mockResolvedValue({ version: 1, updatedAt: null, entries: {} }),
    writeLedger: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function buildApp(overrides: Partial<ExperthubRoutesDeps> = {}) {
  const deps: ExperthubRoutesDeps = {
    catalog: overrides.catalog ?? buildCatalog(),
    installExpert:
      overrides.installExpert ??
      vi.fn().mockResolvedValue({
        ok: true as const,
        botId: "bot_1",
        slug: manifest.slug,
      }),
    createCustomExpert:
      overrides.createCustomExpert ??
      vi.fn().mockResolvedValue({
        ok: true as const,
        botId: "bot_custom",
        slug: "custom-expert",
      }),
    updateExpertSkills:
      overrides.updateExpertSkills ??
      vi.fn().mockResolvedValue({
        ok: true as const,
        configuredSkills: [],
        configuredSkillRefs: [],
      }),
    botService: overrides.botService ?? {
      deleteBot: vi.fn().mockResolvedValue(true),
      // An expert now counts as installed only while its bot still exists, so
      // the fixture ledger's bot has to be live for the catalog assertions.
      listBotIds: vi.fn().mockResolvedValue(["bot_1"]),
    },
    agentsDir: overrides.agentsDir ?? "/tmp/nexu-experthub-test-agents",
    platformTemplatesDir:
      overrides.platformTemplatesDir ?? "/tmp/nexu-experthub-test-templates",
  };
  return { app: buildExperthubRoutes(deps), deps };
}

describe("experthub routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /catalog returns experts, installedSlugs, installedExperts, and meta", async () => {
    const ledger = {
      version: 1 as const,
      updatedAt: "2026-04-17T00:00:00.000Z",
      entries: {
        [manifest.slug]: {
          slug: manifest.slug,
          version: manifest.version,
          botId: "bot_1",
          installedAt: "2026-04-17T00:00:00.000Z",
        },
      },
    };
    const catalog = buildCatalog({
      readLedger: vi.fn().mockResolvedValue(ledger),
      getMeta: vi.fn().mockResolvedValue({
        version: "1.0.0",
        updatedAt: "2026-04-17T00:00:00.000Z",
        count: 1,
      }),
    });
    const { app } = buildApp({ catalog });
    const res = await app.request("/catalog");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      experts: unknown[];
      installedSlugs: string[];
      installedExperts: { slug: string }[];
      meta: { version: string } | null;
    };
    expect(body.experts).toHaveLength(1);
    expect(body.installedSlugs).toEqual([manifest.slug]);
    expect(body.installedExperts).toHaveLength(1);
    expect(body.installedExperts[0]?.slug).toBe(manifest.slug);
    expect(body.meta?.version).toBe("1.0.0");
  });

  it("POST /install calls installExpert and returns its result", async () => {
    const installExpert = vi.fn().mockResolvedValue({
      ok: true as const,
      botId: "bot_42",
      slug: manifest.slug,
    });
    const { app } = buildApp({ installExpert });
    const res = await app.request("/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: manifest.slug }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, botId: "bot_42", slug: manifest.slug });
    expect(installExpert).toHaveBeenCalledWith({ slug: manifest.slug });
  });

  it("POST /install returns 404 when expert not found", async () => {
    const installExpert = vi
      .fn()
      .mockRejectedValue(new ExpertNotFoundError("missing"));
    const { app } = buildApp({ installExpert });
    const res = await app.request("/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "missing" }),
    });
    expect(res.status).toBe(404);
  });

  it("POST /uninstall removes the ledger entry when present", async () => {
    const ledger = {
      version: 1 as const,
      updatedAt: null,
      entries: {
        [manifest.slug]: {
          slug: manifest.slug,
          version: manifest.version,
          botId: "bot_1",
          installedAt: "2026-04-17T00:00:00.000Z",
        },
      },
    };
    const readLedger = vi.fn().mockResolvedValue(ledger);
    const writeLedger = vi.fn().mockResolvedValue(undefined);
    const catalog = buildCatalog({ readLedger, writeLedger });
    const { app } = buildApp({ catalog });
    const res = await app.request("/uninstall", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: manifest.slug }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
    expect(writeLedger).toHaveBeenCalledTimes(1);
    const written = writeLedger.mock.calls[0]?.[0];
    expect(written.entries).toEqual({});
    expect(typeof written.updatedAt).toBe("string");
  });

  it("POST /uninstall is a no-op when ledger has no matching entry", async () => {
    const writeLedger = vi.fn().mockResolvedValue(undefined);
    const catalog = buildCatalog({ writeLedger });
    const { app } = buildApp({ catalog });
    const res = await app.request("/uninstall", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "never-installed" }),
    });
    expect(res.status).toBe(200);
    expect(writeLedger).not.toHaveBeenCalled();
  });

  it("POST /refresh returns the refreshed catalog meta", async () => {
    const meta = {
      version: "1.2.3",
      updatedAt: "2026-04-17T00:00:00.000Z",
      count: 5,
    };
    const refresh = vi.fn().mockResolvedValue(meta);
    const catalog = buildCatalog({ refresh });
    const { app } = buildApp({ catalog });
    const res = await app.request("/refresh", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ meta });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("PUT /experts/{slug}/skills forwards exact skill references", async () => {
    const skillRefs = [
      {
        slug: "weather",
        ownerHandle: "publisher",
        version: "2.0.0",
      },
    ];
    const updateExpertSkills = vi.fn().mockResolvedValue({
      ok: true as const,
      configuredSkills: ["weather"],
      configuredSkillRefs: skillRefs,
    });
    const { app } = buildApp({ updateExpertSkills });

    const res = await app.request(`/experts/${manifest.slug}/skills`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ skills: ["weather"], skillRefs }),
    });

    expect(res.status).toBe(200);
    expect(updateExpertSkills).toHaveBeenCalledWith({
      slug: manifest.slug,
      skills: ["weather"],
      skillRefs,
    });
    await expect(res.json()).resolves.toEqual({
      ok: true,
      configuredSkills: ["weather"],
      configuredSkillRefs: skillRefs,
    });
  });

  it("GET /experts/{slug} returns the full manifest when resolved", async () => {
    const resolveExpert = vi
      .fn()
      .mockResolvedValue({ manifest, source: "bundled" });
    const catalog = buildCatalog({ resolveExpert });
    const { app } = buildApp({ catalog });
    const res = await app.request(`/experts/${manifest.slug}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ExpertManifest;
    expect(body.slug).toBe(manifest.slug);
    expect(body.systemPrompt).toBe(manifest.systemPrompt);
    expect(body.modelId).toBe(manifest.modelId);
    expect(resolveExpert).toHaveBeenCalledWith(manifest.slug);
  });

  it("GET /experts/{slug} returns 404 when catalog does not resolve the slug", async () => {
    const resolveExpert = vi.fn().mockResolvedValue(null);
    const catalog = buildCatalog({ resolveExpert });
    const { app } = buildApp({ catalog });
    const res = await app.request("/experts/unknown");
    expect(res.status).toBe(404);
  });
});
