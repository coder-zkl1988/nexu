import path from "node:path";
import type { ExpertManifest } from "@nexu/shared";
import type { ExpertLedger, ResolvedExpert } from "./types.js";

/**
 * Minimal surface of the dependencies installExpert needs. Keeping this
 * narrow makes the flow trivial to unit-test with plain mocks, and keeps
 * the experthub module decoupled from the concrete service classes.
 */
export type InstallExpertDeps = {
  catalog: {
    resolveExpert: (slug: string) => Promise<ResolvedExpert | null>;
    readLedger: () => Promise<ExpertLedger>;
    writeLedger: (ledger: ExpertLedger) => Promise<void>;
  };
  botService: {
    createBot: (input: {
      name: string;
      slug: string;
      systemPrompt: string;
      modelId: string;
      expertSlug: string;
    }) => Promise<{ id: string; slug: string }>;
  };
  skillhub: {
    install: (input: {
      slug: string;
      agentId: string;
      source: "workspace";
    }) => Promise<{ ok: boolean; error?: string }>;
  };
  sync: {
    syncAll: () => Promise<unknown>;
  };
  fs: {
    writeFile: (p: string, data: string) => Promise<void>;
    mkdir: (p: string, opts?: { recursive: boolean }) => Promise<void>;
  };
  agentsDir: string;
  genBotSlug: (expertSlug: string) => string;
};

export type InstallExpertResult = {
  ok: true;
  botId: string;
  slug: string;
};

/**
 * Install an expert end-to-end:
 *   1. Resolve the expert manifest from the catalog
 *   2. Create a bot seeded with the expert's systemPrompt/modelId
 *   3. Install each required skill bound to the new bot's workspace
 *   4. Write workspace files under `<agentsDir>/<botId>/<path>` (with
 *      path-traversal guard)
 *   5. Append an installation record to the experthub ledger
 *   6. Trigger an OpenClaw sync
 *
 * All external collaborators are injected so this function is unit-testable
 * with plain mocks and free of transitive module side-effects.
 */
export async function installExpert(args: {
  slug: string;
  deps: InstallExpertDeps;
}): Promise<InstallExpertResult> {
  const { slug, deps } = args;

  const resolved = await deps.catalog.resolveExpert(slug);
  if (!resolved) {
    throw new Error(`Expert not found: ${slug}`);
  }
  const manifest: ExpertManifest = resolved.manifest;

  // Validate workspace file paths *before* creating the bot so a malicious
  // manifest cannot leave half-state behind.
  for (const relPath of Object.keys(manifest.workspaceFiles)) {
    assertSafeWorkspacePath(relPath);
  }

  const bot = await deps.botService.createBot({
    name: manifest.name,
    slug: deps.genBotSlug(manifest.slug),
    systemPrompt: manifest.systemPrompt,
    modelId: manifest.modelId,
    expertSlug: manifest.slug,
  });

  for (const skillSlug of manifest.requiredSkills) {
    await deps.skillhub.install({
      slug: skillSlug,
      agentId: bot.id,
      source: "workspace",
    });
  }

  const workspaceRoot = path.join(deps.agentsDir, bot.id);
  await deps.fs.mkdir(workspaceRoot, { recursive: true });
  for (const [relPath, content] of Object.entries(manifest.workspaceFiles)) {
    const safeRel = normalizeWorkspacePath(relPath);
    const target = path.join(workspaceRoot, safeRel);
    await deps.fs.mkdir(path.dirname(target), { recursive: true });
    await deps.fs.writeFile(target, content);
  }

  const ledger = await deps.catalog.readLedger();
  const installedAt = new Date().toISOString();
  ledger.entries[manifest.slug] = {
    slug: manifest.slug,
    version: manifest.version,
    botId: bot.id,
    installedAt,
  };
  ledger.updatedAt = installedAt;
  await deps.catalog.writeLedger(ledger);

  await deps.sync.syncAll();

  return { ok: true, botId: bot.id, slug: manifest.slug };
}

/**
 * Guards against `..` traversal and absolute paths in manifest-supplied
 * workspace file keys. Normalizes POSIX separators so the same rules apply
 * on Windows.
 */
function assertSafeWorkspacePath(relPath: string): void {
  const normalized = normalizeWorkspacePath(relPath);
  if (
    normalized.length === 0 ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    normalized.endsWith("/..")
  ) {
    throw new Error(`Invalid workspace file path: ${relPath}`);
  }
  if (path.isAbsolute(relPath) || /^[A-Za-z]:[\\/]/.test(relPath)) {
    throw new Error(`Invalid workspace file path: ${relPath}`);
  }
}

function normalizeWorkspacePath(relPath: string): string {
  // Normalize to POSIX-style separators and strip any leading slashes so
  // `path.join(root, safeRel)` always stays under `root`.
  const posix = relPath.replace(/\\/g, "/");
  const stripped = posix.replace(/^\/+/, "");
  return path.posix.normalize(stripped);
}
