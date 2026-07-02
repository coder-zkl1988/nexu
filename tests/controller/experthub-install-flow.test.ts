import path from "node:path";
import type { ExpertManifest } from "@nexu/shared";
import { describe, expect, it, vi } from "vitest";
import {
  ExpertNotFoundError,
  type InstallExpertDeps,
  installExpert,
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
  defaultModelId: InstallExpertDeps["defaultModelId"];
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
    defaultModelId: overrides.defaultModelId ?? "openai/gpt-5",
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
