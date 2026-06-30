import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { foldPersonaIntoAgents } from "./install-flow.js";
import type { ExpertLedger } from "./types.js";

/**
 * Fold each installed expert's SOUL.md persona into its AGENTS.md so the persona
 * survives native sub-agent delegation (sub-agents only load AGENTS.md + TOOLS.md
 * — SUBAGENT_BOOTSTRAP_ALLOWLIST). Experts installed before the in-chat
 * delegation feature never had the fold applied at install time; this back-fills
 * them. Idempotent (foldPersonaIntoAgents replaces a managed block), so it is safe
 * to run on every controller boot. Returns the number of expert workspaces updated.
 */
export async function ensureExpertPersonaFolds(params: {
  readLedger: () => Promise<ExpertLedger>;
  agentsDir: string;
}): Promise<number> {
  const ledger = await params.readLedger();
  let updated = 0;
  for (const entry of Object.values(ledger.entries)) {
    if (!entry.botId) {
      continue;
    }
    const agentDir = path.join(params.agentsDir, entry.botId);
    let soul: string;
    try {
      soul = await readFile(path.join(agentDir, "SOUL.md"), "utf8");
    } catch {
      continue; // No SOUL.md — nothing to fold.
    }
    if (!soul.trim()) {
      continue;
    }
    const agentsPath = path.join(agentDir, "AGENTS.md");
    let agents = "";
    try {
      agents = await readFile(agentsPath, "utf8");
    } catch {
      // No AGENTS.md yet — synthesize one carrying the persona.
    }
    const next = foldPersonaIntoAgents(agents, soul);
    if (next !== agents) {
      await writeFile(agentsPath, next);
      updated += 1;
    }
  }
  return updated;
}
