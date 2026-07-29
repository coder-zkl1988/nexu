import { randomUUID } from "node:crypto";
import path from "node:path";
import type { ExpertManifest, SkillReference } from "@nexu/shared";
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
      ownerHandle?: string;
      version?: string;
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
  /** Resolve the current global default model (config.runtime.defaultModelId). */
  getGlobalModelId: () => Promise<string>;
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

function normalizeSkillReference(reference: SkillReference): SkillReference {
  const ownerHandle = reference.ownerHandle
    ?.replace(/^@+/, "")
    .trim()
    .toLowerCase();
  return {
    slug: reference.slug,
    ...(ownerHandle ? { ownerHandle } : {}),
    ...(reference.version ? { version: reference.version } : {}),
  };
}

function skillReferenceKey(reference: SkillReference): string {
  const normalized = normalizeSkillReference(reference);
  const identity = normalized.ownerHandle
    ? `@${normalized.ownerHandle}/${normalized.slug}`
    : normalized.slug;
  return normalized.version ? `${identity}@${normalized.version}` : identity;
}

function resolveSkillReferences(
  skills: string[],
  skillRefs?: SkillReference[],
): SkillReference[] {
  if (!skillRefs) {
    return [...new Set(skills)].map((slug) => ({ slug }));
  }
  const normalized = skillRefs.map(normalizeSkillReference);
  if (
    normalized.length !== skills.length ||
    normalized.some((reference, index) => reference.slug !== skills[index])
  ) {
    throw new Error("Skill references do not match submitted skill slugs");
  }
  const seenSlugs = new Set<string>();
  for (const reference of normalized) {
    if (seenSlugs.has(reference.slug)) {
      throw new Error(`Duplicate skill reference: ${reference.slug}`);
    }
    seenSlugs.add(reference.slug);
  }
  return normalized;
}

function mergeSkillReferences(...groups: SkillReference[][]): SkillReference[] {
  const merged: SkillReference[] = [];
  const seenSlugs = new Set<string>();
  for (const reference of groups.flat()) {
    if (seenSlugs.has(reference.slug)) continue;
    seenSlugs.add(reference.slug);
    merged.push(normalizeSkillReference(reference));
  }
  return merged;
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

  // When the expert manifest doesn't pin a real model, use the *current* global
  // default model (config.runtime.defaultModelId) — not the static env fallback.
  const modelId =
    manifest.modelId && manifest.modelId !== "gpt-4o"
      ? manifest.modelId
      : await deps.getGlobalModelId();

  const bot = await deps.botService.createBot({
    name: manifest.name,
    slug: deps.genBotSlug(manifest.slug),
    systemPrompt: manifest.systemPrompt,
    modelId,
    expertSlug: manifest.slug,
  });

  // Read ledger before installing skills so we can merge any
  // skills the user pre-configured before installing the expert.
  const preLedger = await deps.catalog.readLedger();
  const preConfiguredSkills =
    preLedger.entries[manifest.slug]?.configuredSkills ?? [];
  const preConfiguredSkillRefs = resolveSkillReferences(
    preConfiguredSkills,
    preLedger.entries[manifest.slug]?.configuredSkillRefs,
  );
  const allSkillsToInstall = mergeSkillReferences(
    preConfiguredSkillRefs,
    manifest.requiredSkills.map((skillSlug) => ({ slug: skillSlug })),
  );

  // Install each skill, continuing on failure so one broken
  // skill download doesn't block the rest of the expert setup.
  for (const skill of allSkillsToInstall) {
    const result = await deps.skillhub.install({
      ...skill,
      agentId: bot.id,
      source: "workspace",
    });
    if (!result.ok) {
      // Skill ledger already records the failure independently;
      // the expert detail page shows per-skill installed status.
    }
  }

  const workspaceRoot = path.join(deps.agentsDir, bot.id);
  await deps.fs.mkdir(workspaceRoot, { recursive: true });
  const soulPersona = manifest.workspaceFiles["SOUL.md"];
  for (const [relPath, content] of Object.entries(manifest.workspaceFiles)) {
    const safeRel = normalizeWorkspacePath(relPath);
    const target = path.join(workspaceRoot, safeRel);
    await deps.fs.mkdir(path.dirname(target), { recursive: true });
    // Fold SOUL.md persona into AGENTS.md so it survives sub-agent delegation.
    const toWrite =
      safeRel === "AGENTS.md" && soulPersona
        ? foldPersonaIntoAgents(content, soulPersona)
        : content;
    await deps.fs.writeFile(target, toWrite);
  }

  // Experts carry their own identity; remove the platform BOOTSTRAP.md so it
  // doesn't override the expert persona with a generic "Tabby agent" overlay.
  try {
    await deps.fs.rm(path.join(workspaceRoot, "BOOTSTRAP.md"));
  } catch {
    // May not exist — fine.
  }

  // Re-read ledger after install in case it changed — then merge entry.
  const ledger = await deps.catalog.readLedger();
  const installedAt = new Date().toISOString();
  ledger.entries[manifest.slug] = {
    ...ledger.entries[manifest.slug],
    slug: manifest.slug,
    version: manifest.version,
    botId: bot.id,
    installedAt,
    configuredSkills: preConfiguredSkills,
    configuredSkillRefs: preConfiguredSkillRefs,
  };
  ledger.updatedAt = installedAt;
  await deps.catalog.writeLedger(ledger);

  await deps.sync.syncAll();

  return { ok: true, botId: bot.id, slug: manifest.slug };
}

const PERSONA_BLOCK_BEGIN = "<!-- NEXU:PERSONA:BEGIN -->";
const PERSONA_BLOCK_END = "<!-- NEXU:PERSONA:END -->";

/**
 * Fold an expert's SOUL.md persona into its AGENTS.md inside a managed block so
 * the persona survives native sub-agent delegation: OpenClaw's
 * SUBAGENT_BOOTSTRAP_ALLOWLIST only injects AGENTS.md + TOOLS.md into a sub-agent,
 * so a delegated expert would otherwise lose its SOUL.md persona. Idempotent —
 * re-running replaces the managed block. See
 * specs/design-docs/2026-06-30-in-chat-expert-auto-route.md.
 */
export function foldPersonaIntoAgents(
  agentsContent: string,
  soul: string,
): string {
  const persona = soul.trim();
  if (!persona) {
    return agentsContent;
  }
  const block = `${PERSONA_BLOCK_BEGIN}\n## 角色人设 (Persona)\n\n${persona}\n${PERSONA_BLOCK_END}`;
  const base = stripPersonaBlock(agentsContent).trimEnd();
  return base ? `${base}\n\n${block}\n` : `${block}\n`;
}

function stripPersonaBlock(content: string): string {
  const start = content.indexOf(PERSONA_BLOCK_BEGIN);
  if (start === -1) {
    return content;
  }
  const end = content.indexOf(PERSONA_BLOCK_END);
  if (end === -1) {
    return content.slice(0, start);
  }
  return (
    content.slice(0, start) + content.slice(end + PERSONA_BLOCK_END.length)
  );
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
      ownerHandle?: string;
      version?: string;
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
        (l) => l.includes(`**Name:** ${name}`) || l.includes("**Name:**"),
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
  skillRefs?: SkillReference[];
  existingSlug?: string;
  workspaceFiles: Record<string, string>;
  deps: CreateCustomExpertDeps;
}): Promise<{ ok: true; botId: string; slug: string }> {
  const {
    name,
    modelId,
    description,
    skills,
    skillRefs,
    existingSlug,
    workspaceFiles,
    deps,
  } = args;

  const ledger = await deps.catalog.readLedger();
  const resolvedSkillRefs = resolveSkillReferences(skills, skillRefs);

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

  for (const skill of resolvedSkillRefs) {
    await deps.skillhub.install({
      ...skill,
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

  const soulPersona = workspaceFiles["SOUL.md"];
  for (const [relPath, content] of Object.entries(workspaceFiles)) {
    if (!content) continue;
    const safeRel = normalizeWorkspacePath(relPath);
    const target = path.join(workspaceRoot, safeRel);
    await deps.fs.mkdir(path.dirname(target), { recursive: true });
    // Fold SOUL.md persona into AGENTS.md so it survives sub-agent delegation.
    const toWrite =
      safeRel === "AGENTS.md" && soulPersona
        ? foldPersonaIntoAgents(content, soulPersona)
        : content;
    await deps.fs.writeFile(target, toWrite);
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
    configuredSkills: skills,
    configuredSkillRefs: resolvedSkillRefs,
  };
  ledger.updatedAt = installedAt;
  await deps.catalog.writeLedger(ledger);

  await deps.sync.syncAll();

  return { ok: true, botId: bot.id, slug: expertSlug };
}

export type UpdateExpertSkillsDeps = {
  catalog: {
    resolveExpert: (slug: string) => Promise<ResolvedExpert | null>;
    readLedger: () => Promise<ExpertLedger>;
    writeLedger: (ledger: ExpertLedger) => Promise<void>;
  };
  skillhub: {
    install: (input: {
      slug: string;
      ownerHandle?: string;
      version?: string;
      agentId: string;
      source: "workspace";
    }) => Promise<{ ok: boolean; error?: string }>;
    uninstall: (input: {
      slug: string;
      agentId: string;
    }) => Promise<{ ok: boolean; error?: string }>;
  };
  sync: {
    syncAll: () => Promise<unknown>;
  };
};

export async function updateExpertSkills(args: {
  slug: string;
  skills: string[];
  skillRefs?: SkillReference[];
  deps: UpdateExpertSkillsDeps;
}): Promise<{
  ok: true;
  configuredSkills: string[];
  configuredSkillRefs: SkillReference[];
}> {
  const { slug, skills: submittedSkills } = args;
  const { deps } = args;
  let submittedSkillRefs = resolveSkillReferences(
    submittedSkills,
    args.skillRefs,
  );

  const resolved = await deps.catalog.resolveExpert(slug);
  const requiredSkills = resolved?.manifest.requiredSkills ?? [];

  // Always merge required skills — server-side enforcement
  const finalSkillRefs = mergeSkillReferences(
    submittedSkillRefs,
    requiredSkills.map((skillSlug) => ({ slug: skillSlug })),
  );

  const ledger = await deps.catalog.readLedger();
  const entry = ledger.entries[slug];

  if (entry?.botId) {
    // Installed expert: diff and apply changes to bot workspace
    const prevSkills = entry.configuredSkills ?? requiredSkills;
    const prevSkillRefs = mergeSkillReferences(
      resolveSkillReferences(prevSkills, entry.configuredSkillRefs),
      requiredSkills.map((skillSlug) => ({ slug: skillSlug })),
    );
    const prevKeys = new Set(prevSkillRefs.map(skillReferenceKey));
    const finalKeys = new Set(finalSkillRefs.map(skillReferenceKey));

    const toAdd = finalSkillRefs.filter(
      (reference) => !prevKeys.has(skillReferenceKey(reference)),
    );
    const toRemove = prevSkillRefs.filter(
      (reference) =>
        !finalKeys.has(skillReferenceKey(reference)) &&
        !requiredSkills.includes(reference.slug),
    );

    const replacementSlugs = new Set(toAdd.map((skill) => skill.slug));
    for (const skill of toAdd) {
      const result = await deps.skillhub.install({
        ...skill,
        agentId: entry.botId,
        source: "workspace",
      });
      if (!result.ok) {
        const previousReference = prevSkillRefs.find(
          (reference) => reference.slug === skill.slug,
        );
        submittedSkillRefs = previousReference
          ? submittedSkillRefs.map((reference) =>
              reference.slug === skill.slug ? previousReference : reference,
            )
          : submittedSkillRefs.filter(
              (reference) => reference.slug !== skill.slug,
            );
      }
    }

    for (const skill of toRemove) {
      // Same-slug additions replace the physical workspace directory
      // transactionally. On failure the installer restores the old copy.
      if (replacementSlugs.has(skill.slug)) continue;
      const result = await deps.skillhub.uninstall({
        slug: skill.slug,
        agentId: entry.botId,
      });
      if (!result.ok) {
        submittedSkillRefs = mergeSkillReferences(submittedSkillRefs, [skill]);
      }
    }
  }

  const savedSkills = submittedSkillRefs.map((reference) => reference.slug);

  // Write configured skills to ledger
  ledger.entries[slug] = {
    ...entry,
    slug,
    version: entry?.version ?? "",
    botId: entry?.botId ?? "",
    installedAt: entry?.installedAt ?? "",
    configuredSkills: savedSkills,
    configuredSkillRefs: submittedSkillRefs,
  };
  ledger.updatedAt = new Date().toISOString();
  await deps.catalog.writeLedger(ledger);

  await deps.sync.syncAll();

  return {
    ok: true,
    configuredSkills: savedSkills,
    configuredSkillRefs: submittedSkillRefs,
  };
}

export const DEFAULT_EXPERT_SLUGS = [
  "marketing-china-market-localization-strategist",
  "marketing-xiaohongshu-operator",
  "marketing-xiaohongshu-specialist",
] as const;

export async function installDefaultExperts(args: {
  slugs: readonly string[];
  deps: InstallExpertDeps;
}): Promise<{ installed: string[]; skipped: string[] }> {
  const ledger = await args.deps.catalog.readLedger();
  const installed: string[] = [];
  const skipped: string[] = [];

  for (const slug of args.slugs) {
    if (ledger.entries[slug]) {
      skipped.push(slug);
      continue;
    }

    try {
      await installExpert({ slug, deps: args.deps });
      installed.push(slug);
    } catch {
      skipped.push(slug);
    }
  }

  return { installed, skipped };
}
