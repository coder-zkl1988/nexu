import path from "node:path";
import type { ExpertManifest } from "@nexu/shared";
import { describe, expect, it, vi } from "vitest";
import {
  ExpertNotFoundError,
  type InstallExpertDeps,
  installExpert,
  updateExpertSkills,
} from "../../apps/controller/src/services/experthub/install-flow.js";

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
  requiredSkills: ["git-diff"],
  workspaceFiles: { "AGENTS.md": "# Reviewer" },
};

type Overrides = Partial<{
  catalog: Partial<InstallExpertDeps["catalog"]>;
  botService: Partial<InstallExpertDeps["botService"]>;
  skillhub: Partial<InstallExpertDeps["skillhub"]>;
  sync: Partial<InstallExpertDeps["sync"]>;
  fs: Partial<InstallExpertDeps["fs"]>;
  agentsDir: string;
  genBotSlug: InstallExpertDeps["genBotSlug"];
  getGlobalModelId: InstallExpertDeps["getGlobalModelId"];
}>;

function buildDeps(overrides: Overrides = {}): InstallExpertDeps {
  const resolveExpert = vi
    .fn()
    .mockResolvedValue({ manifest, source: "bundled" });
  const readLedger = vi
    .fn()
    .mockResolvedValue({ version: 1, updatedAt: null, entries: {} });
  const writeLedger = vi.fn().mockResolvedValue(undefined);

  const createBot = vi
    .fn()
    .mockResolvedValue({ id: "bot_1", slug: "code-reviewer-abc" });

  const install = vi.fn().mockResolvedValue({ ok: true });
  const syncAll = vi.fn().mockResolvedValue(undefined);

  const writeFile = vi.fn().mockResolvedValue(undefined);
  const mkdir = vi.fn().mockResolvedValue(undefined);

  const genBotSlug = vi.fn((s: string) => `${s}-abc`);

  return {
    catalog: {
      resolveExpert,
      readLedger,
      writeLedger,
      ...overrides.catalog,
    },
    botService: {
      createBot,
      ...overrides.botService,
    },
    skillhub: {
      install,
      ...overrides.skillhub,
    },
    sync: {
      syncAll,
      ...overrides.sync,
    },
    fs: {
      writeFile,
      mkdir,
      ...overrides.fs,
    },
    agentsDir: overrides.agentsDir ?? "/state/agents",
    genBotSlug: overrides.genBotSlug ?? genBotSlug,
    // installExpert resolves the *current* global default model rather than a
    // static value, so the fake is a function too.
    getGlobalModelId:
      overrides.getGlobalModelId ?? (async () => "openai/gpt-5"),
  };
}

describe("installExpert", () => {
  it("creates bot, installs skills, writes workspace files, updates ledger, syncs", async () => {
    const deps = buildDeps();
    const r = await installExpert({ slug: "code-reviewer", deps });
    expect(r).toEqual({ ok: true, botId: "bot_1", slug: "code-reviewer" });
    expect(deps.botService.createBot).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Code Reviewer",
        slug: "code-reviewer-abc",
        systemPrompt: "You review code.",
        modelId: "openai/gpt-5",
        expertSlug: "code-reviewer",
      }),
    );
    expect(deps.skillhub.install).toHaveBeenCalledWith({
      slug: "git-diff",
      agentId: "bot_1",
      source: "workspace",
    });
    // install-flow builds paths with path.join, so expectations must use
    // platform-native separators (backslashes on Windows).
    expect(deps.fs.mkdir).toHaveBeenCalledWith(
      path.join("/state/agents", "bot_1"),
      {
        recursive: true,
      },
    );
    expect(deps.fs.writeFile).toHaveBeenCalledWith(
      path.join("/state/agents", "bot_1", "AGENTS.md"),
      "# Reviewer",
    );
    expect(deps.catalog.writeLedger).toHaveBeenCalledWith(
      expect.objectContaining({
        entries: expect.objectContaining({
          "code-reviewer": expect.objectContaining({
            botId: "bot_1",
            version: "1.0.0",
            slug: "code-reviewer",
          }),
        }),
      }),
    );
    expect(deps.sync.syncAll).toHaveBeenCalled();
  });

  it("throws ExpertNotFoundError when expert not found", async () => {
    const deps = buildDeps({
      catalog: { resolveExpert: vi.fn().mockResolvedValue(null) },
    });
    await expect(
      installExpert({ slug: "missing", deps }),
    ).rejects.toBeInstanceOf(ExpertNotFoundError);
    await expect(installExpert({ slug: "missing", deps })).rejects.toThrow(
      /not found/i,
    );
  });

  it("rejects workspace file paths with traversal", async () => {
    const deps = buildDeps({
      catalog: {
        resolveExpert: vi.fn().mockResolvedValue({
          manifest: {
            ...manifest,
            workspaceFiles: { "../escape.txt": "pwned" },
          },
          source: "bundled",
        }),
      },
    });
    await expect(
      installExpert({ slug: "code-reviewer", deps }),
    ).rejects.toThrow(/invalid workspace file path/i);
  });

  it("rejects absolute workspace file paths", async () => {
    const deps = buildDeps({
      catalog: {
        resolveExpert: vi.fn().mockResolvedValue({
          manifest: { ...manifest, workspaceFiles: { "/etc/passwd": "pwned" } },
          source: "bundled",
        }),
      },
    });
    await expect(
      installExpert({ slug: "code-reviewer", deps }),
    ).rejects.toThrow(/invalid workspace file path/i);
  });

  it("with no skills and no workspace files, still creates bot + ledger + syncs", async () => {
    const deps = buildDeps({
      catalog: {
        resolveExpert: vi.fn().mockResolvedValue({
          manifest: { ...manifest, requiredSkills: [], workspaceFiles: {} },
          source: "bundled",
        }),
      },
    });
    const r = await installExpert({ slug: "code-reviewer", deps });
    expect(r.ok).toBe(true);
    expect(deps.skillhub.install).not.toHaveBeenCalled();
    expect(deps.fs.writeFile).not.toHaveBeenCalled();
    expect(deps.catalog.writeLedger).toHaveBeenCalled();
    expect(deps.sync.syncAll).toHaveBeenCalled();
  });

  it("creates nested directories for workspace files in sub-paths", async () => {
    const deps = buildDeps({
      catalog: {
        resolveExpert: vi.fn().mockResolvedValue({
          manifest: {
            ...manifest,
            workspaceFiles: { "docs/guide.md": "content" },
          },
          source: "bundled",
        }),
      },
    });
    await installExpert({ slug: "code-reviewer", deps });
    expect(deps.fs.mkdir).toHaveBeenCalledWith(
      path.join("/state/agents", "bot_1", "docs"),
      {
        recursive: true,
      },
    );
    expect(deps.fs.writeFile).toHaveBeenCalledWith(
      path.join("/state/agents", "bot_1", "docs", "guide.md"),
      "content",
    );
  });
});

describe("expert skill references", () => {
  it("installs a preconfigured expert skill from the selected publisher", async () => {
    const ledger = {
      version: 1 as const,
      updatedAt: null,
      entries: {
        "code-reviewer": {
          slug: "code-reviewer",
          version: "1.0.0",
          botId: "",
          installedAt: "",
          configuredSkills: ["weather"],
          configuredSkillRefs: [
            {
              slug: "weather",
              ownerHandle: "category-winner",
              version: "2.3.4",
            },
          ],
        },
      },
    };
    const deps = buildDeps({
      catalog: { readLedger: vi.fn().mockResolvedValue(ledger) },
    });

    await installExpert({ slug: "code-reviewer", deps });

    expect(deps.skillhub.install).toHaveBeenCalledWith({
      slug: "weather",
      ownerHandle: "category-winner",
      version: "2.3.4",
      agentId: "bot_1",
      source: "workspace",
    });
  });

  it("uses an exact configured reference for a required skill", async () => {
    const ledger = {
      version: 1 as const,
      updatedAt: null,
      entries: {
        "code-reviewer": {
          slug: "code-reviewer",
          version: "1.0.0",
          botId: "",
          installedAt: "",
          configuredSkills: ["git-diff"],
          configuredSkillRefs: [
            {
              slug: "git-diff",
              ownerHandle: "trusted",
              version: "3.0.0",
            },
          ],
        },
      },
    };
    const deps = buildDeps({
      catalog: { readLedger: vi.fn().mockResolvedValue(ledger) },
    });

    await installExpert({ slug: "code-reviewer", deps });

    expect(deps.skillhub.install).toHaveBeenCalledTimes(1);
    expect(deps.skillhub.install).toHaveBeenCalledWith({
      slug: "git-diff",
      ownerHandle: "trusted",
      version: "3.0.0",
      agentId: "bot_1",
      source: "workspace",
    });
  });

  it("persists and installs exact references when expert skills are updated", async () => {
    const ledger = {
      version: 1 as const,
      updatedAt: null,
      entries: {
        "code-reviewer": {
          slug: "code-reviewer",
          version: "1.0.0",
          botId: "bot_1",
          installedAt: "2026-07-29T00:00:00.000Z",
          configuredSkills: [],
          configuredSkillRefs: [],
        },
      },
    };
    const install = vi.fn().mockResolvedValue({ ok: true });
    const writeLedger = vi.fn().mockResolvedValue(undefined);
    const syncAll = vi.fn().mockResolvedValue(undefined);

    const result = await updateExpertSkills({
      slug: "code-reviewer",
      skills: ["weather"],
      skillRefs: [
        {
          slug: "weather",
          ownerHandle: "category-winner",
          version: "2.3.4",
        },
      ],
      deps: {
        catalog: {
          resolveExpert: vi
            .fn()
            .mockResolvedValue({ manifest, source: "bundled" }),
          readLedger: vi.fn().mockResolvedValue(ledger),
          writeLedger,
        },
        skillhub: {
          install,
          uninstall: vi.fn().mockResolvedValue({ ok: true }),
        },
        sync: { syncAll },
      },
    });

    expect(install).toHaveBeenCalledWith({
      slug: "weather",
      ownerHandle: "category-winner",
      version: "2.3.4",
      agentId: "bot_1",
      source: "workspace",
    });
    expect(result).toEqual({
      ok: true,
      configuredSkills: ["weather"],
      configuredSkillRefs: [
        {
          slug: "weather",
          ownerHandle: "category-winner",
          version: "2.3.4",
        },
      ],
    });
    expect(writeLedger).toHaveBeenCalledWith(
      expect.objectContaining({
        entries: expect.objectContaining({
          "code-reviewer": expect.objectContaining({
            configuredSkills: ["weather"],
            configuredSkillRefs: [
              {
                slug: "weather",
                ownerHandle: "category-winner",
                version: "2.3.4",
              },
            ],
          }),
        }),
      }),
    );
  });

  it("rejects inconsistent legacy slugs and exact references", async () => {
    await expect(
      updateExpertSkills({
        slug: "code-reviewer",
        skills: ["weather"],
        skillRefs: [{ slug: "calendar", ownerHandle: "publisher" }],
        deps: {
          catalog: {
            resolveExpert: vi.fn(),
            readLedger: vi.fn(),
            writeLedger: vi.fn(),
          },
          skillhub: {
            install: vi.fn(),
            uninstall: vi.fn(),
          },
          sync: { syncAll: vi.fn() },
        },
      }),
    ).rejects.toThrow("Skill references do not match submitted skill slugs");
  });

  it("keeps the previous publisher when a same-slug replacement fails", async () => {
    const previousReference = {
      slug: "weather",
      ownerHandle: "publisher-a",
      version: "1.0.0",
    };
    const ledger = {
      version: 1 as const,
      updatedAt: null,
      entries: {
        "code-reviewer": {
          slug: "code-reviewer",
          version: "1.0.0",
          botId: "bot_1",
          installedAt: "2026-07-29T00:00:00.000Z",
          configuredSkills: ["weather"],
          configuredSkillRefs: [previousReference],
        },
      },
    };
    const install = vi.fn().mockResolvedValue({
      ok: false,
      error: "publisher conflict",
    });
    const uninstall = vi.fn().mockResolvedValue({ ok: true });
    const writeLedger = vi.fn().mockResolvedValue(undefined);

    const result = await updateExpertSkills({
      slug: "code-reviewer",
      skills: ["weather"],
      skillRefs: [
        {
          slug: "weather",
          ownerHandle: "publisher-b",
          version: "2.0.0",
        },
      ],
      deps: {
        catalog: {
          resolveExpert: vi
            .fn()
            .mockResolvedValue({ manifest, source: "bundled" }),
          readLedger: vi.fn().mockResolvedValue(ledger),
          writeLedger,
        },
        skillhub: { install, uninstall },
        sync: { syncAll: vi.fn().mockResolvedValue(undefined) },
      },
    });

    expect(uninstall).not.toHaveBeenCalled();
    expect(result.configuredSkillRefs).toEqual([previousReference]);
    expect(writeLedger).toHaveBeenCalledWith(
      expect.objectContaining({
        entries: expect.objectContaining({
          "code-reviewer": expect.objectContaining({
            configuredSkillRefs: [previousReference],
          }),
        }),
      }),
    );
  });

  it("reinstalls a selected skill when only its version changes", async () => {
    const ledger = {
      version: 1 as const,
      updatedAt: null,
      entries: {
        "code-reviewer": {
          slug: "code-reviewer",
          version: "1.0.0",
          botId: "bot_1",
          installedAt: "2026-07-29T00:00:00.000Z",
          configuredSkills: ["weather"],
          configuredSkillRefs: [
            {
              slug: "weather",
              ownerHandle: "publisher",
              version: "1.0.0",
            },
          ],
        },
      },
    };
    const install = vi.fn().mockResolvedValue({ ok: true });
    const uninstall = vi.fn().mockResolvedValue({ ok: true });

    await updateExpertSkills({
      slug: "code-reviewer",
      skills: ["weather"],
      skillRefs: [
        {
          slug: "weather",
          ownerHandle: "publisher",
          version: "2.0.0",
        },
      ],
      deps: {
        catalog: {
          resolveExpert: vi
            .fn()
            .mockResolvedValue({ manifest, source: "bundled" }),
          readLedger: vi.fn().mockResolvedValue(ledger),
          writeLedger: vi.fn().mockResolvedValue(undefined),
        },
        skillhub: { install, uninstall },
        sync: { syncAll: vi.fn().mockResolvedValue(undefined) },
      },
    });

    expect(install).toHaveBeenCalledWith({
      slug: "weather",
      ownerHandle: "publisher",
      version: "2.0.0",
      agentId: "bot_1",
      source: "workspace",
    });
    expect(uninstall).not.toHaveBeenCalled();
  });
});
