import { randomUUID } from "node:crypto";
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
    rm: (p: string) => Promise<void>;
  };
  agentsDir: string;
  genBotSlug: (expertSlug: string) => string;
  defaultModelId: string;
};

export type InstallExpertResult = {
  ok: true;
  botId: string;
  slug: string;
};

/**
 * Thrown by `installExpert` when the requested slug cannot be resolved by the
 * catalog manager. The route layer uses `instanceof` to map this to HTTP 404
 * without fragile substring matching on the error message.
 */
export class ExpertNotFoundError extends Error {
  readonly slug: string;
  constructor(slug: string) {
    super(`Expert not found: ${slug}`);
    this.name = "ExpertNotFoundError";
    this.slug = slug;
  }
}

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
    throw new ExpertNotFoundError(slug);
  }
  const manifest: ExpertManifest = resolved.manifest;

  // Validate workspace file paths *before* creating the bot so a malicious
  // manifest cannot leave half-state behind.
  for (const relPath of Object.keys(manifest.workspaceFiles)) {
    assertSafeWorkspacePath(relPath);
  }

  // Use global default model when expert doesn't specify a real model
  const modelId =
    manifest.modelId && manifest.modelId !== "gpt-4o"
      ? manifest.modelId
      : deps.defaultModelId;

  const bot = await deps.botService.createBot({
    name: manifest.name,
    slug: deps.genBotSlug(manifest.slug),
    systemPrompt: manifest.systemPrompt,
    modelId,
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

  // Experts carry their own identity; remove the platform BOOTSTRAP.md so it
  // doesn't override the expert persona with a generic "Tabby agent" overlay.
  try {
    await deps.fs.rm(path.join(workspaceRoot, "BOOTSTRAP.md"));
  } catch {
    // May not exist — fine.
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
  const posix = relPath.replace(/\\/g, "/");
  const stripped = posix.replace(/^\/+/, "");
  return path.posix.normalize(stripped);
}

export type CreateCustomExpertDeps = {
  catalog: {
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
    getBotByExpertSlug: (slug: string) => Promise<{ id: string } | null>;
    deleteBot: (id: string) => Promise<void>;
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
    rm: (p: string, opts?: { recursive: boolean }) => Promise<void>;
  };
  agentsDir: string;
};

function injectIdentityInfo(
  content: string,
  name: string,
  description: string | null,
): string {
  const nameLine = `- **Name:** ${name}`;
  const lines = content.split("\n");

  // Replace the template placeholder line or inject name after the heading
  let replaced = false;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]?.trim() ?? "";
    // Replace placeholder "(pick something you like)" or any empty "Name:" line
    if (/^-\s+\*\*Name:\*\*\s*(_\(.*\)\s*)?$/.test(trimmed)) {
      lines[i] = nameLine;
      replaced = true;
      break;
    }
    // If the name is already filled in (not a placeholder), preserve it
    if (/^-\s+\*\*Name:\*\*\s+\S/.test(trimmed)) {
      replaced = true;
      break;
    }
  }

  if (!replaced) {
    // Inject after the first heading
    const headingIdx = lines.findIndex((l) => l.trim().startsWith("#"));
    if (headingIdx >= 0) {
      lines.splice(headingIdx + 2, 0, nameLine);
    } else {
      lines.unshift(nameLine);
    }
  }

  if (description) {
    const descLine = `- **Description:** ${description}`;
    let descReplaced = false;
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i]?.trim() ?? "";
      if (/^-\s+\*\*Description:\*\*/.test(trimmed)) {
        lines[i] = descLine;
        descReplaced = true;
        break;
      }
    }
    if (!descReplaced) {
      // Insert directly after the name line
      const nameIdx = lines.findIndex(
        (l) => l.includes(`**Name:** ${name}`) || l.includes(`**Name:**`),
      );
      if (nameIdx >= 0) {
        lines.splice(nameIdx + 1, 0, descLine);
      }
    }
  }

  return lines.join("\n");
}

export async function createCustomExpert(args: {
  name: string;
  avatarDataUrl?: string;
  modelId: string;
  description?: string;
  skills: string[];
  existingSlug?: string;
  workspaceFiles: Record<string, string>;
  deps: CreateCustomExpertDeps;
}): Promise<{ ok: true; botId: string; slug: string }> {
  const {
    name,
    modelId,
    description,
    skills,
    existingSlug,
    workspaceFiles,
    deps,
  } = args;

  const ledger = await deps.catalog.readLedger();

  if (existingSlug) {
    const existingEntry = ledger.entries[existingSlug];
    if (existingEntry) {
      try {
        await deps.botService.deleteBot(existingEntry.botId);
      } catch {
        // Ignore if bot already deleted
      }
      try {
        await deps.fs.rm(path.join(deps.agentsDir, existingEntry.botId), {
          recursive: true,
        });
      } catch {
        // Ignore if directory already removed
      }
      delete ledger.entries[existingSlug];
    }
  }

  const expertSlug =
    existingSlug ?? `custom-${randomUUID().replace(/-/g, "").slice(0, 12)}`;

  for (const relPath of Object.keys(workspaceFiles)) {
    assertSafeWorkspacePath(relPath);
  }

  const bot = await deps.botService.createBot({
    name,
    slug: expertSlug,
    systemPrompt: "",
    modelId,
    expertSlug,
  });

  for (const skillSlug of skills) {
    await deps.skillhub.install({
      slug: skillSlug,
      agentId: bot.id,
      source: "workspace",
    });
  }

  const workspaceRoot = path.join(deps.agentsDir, bot.id);
  await deps.fs.mkdir(workspaceRoot, { recursive: true });

  if (args.avatarDataUrl) {
    const avatarPath = path.join(workspaceRoot, "avatar.txt");
    await deps.fs.writeFile(avatarPath, args.avatarDataUrl);
  }

  // Inject bot name and description into IDENTITY.md so the agent's identity
  // reflects the user's choices from day one.
  if (workspaceFiles["IDENTITY.md"]) {
    workspaceFiles["IDENTITY.md"] = injectIdentityInfo(
      workspaceFiles["IDENTITY.md"],
      name,
      description ?? null,
    );
  }

  for (const [relPath, content] of Object.entries(workspaceFiles)) {
    if (!content) continue;
    const safeRel = normalizeWorkspacePath(relPath);
    const target = path.join(workspaceRoot, safeRel);
    await deps.fs.mkdir(path.dirname(target), { recursive: true });
    await deps.fs.writeFile(target, content);
  }

  // Custom experts have their identity fully specified — the bootstrap script
  // telling the agent to "introduce yourself" is unnecessary and would
  // conflict with the user's pre-configured identity.
  const bootstrapPath = path.join(workspaceRoot, "BOOTSTRAP.md");
  try {
    await deps.fs.rm(bootstrapPath);
  } catch {
    // File may not exist or may have already been deleted — either is fine.
  }

  const installedAt = new Date().toISOString();
  ledger.entries[expertSlug] = {
    slug: expertSlug,
    version: "0.0.1",
    botId: bot.id,
    installedAt,
    name,
    avatarDataUrl: args.avatarDataUrl ?? undefined,
    description,
  };
  ledger.updatedAt = installedAt;
  await deps.catalog.writeLedger(ledger);

  await deps.sync.syncAll();

  return { ok: true, botId: bot.id, slug: expertSlug };
}
