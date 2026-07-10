import { describe, expect, it } from "vitest";
import { foldPersonaIntoAgents } from "../src/services/experthub/install-flow.js";

describe("foldPersonaIntoAgents", () => {
  it("appends the persona inside a managed block, preserving AGENTS content", () => {
    const out = foldPersonaIntoAgents("# AGENTS\n\nrules", "I am the expert.");
    expect(out.startsWith("# AGENTS")).toBe(true);
    expect(out).toContain("<!-- NEXU:PERSONA:BEGIN -->");
    expect(out).toContain("I am the expert.");
    expect(out).toContain("<!-- NEXU:PERSONA:END -->");
  });

  it("is idempotent — re-folding replaces the block instead of duplicating", () => {
    const once = foldPersonaIntoAgents("# AGENTS", "v1 persona");
    const twice = foldPersonaIntoAgents(once, "v2 persona");
    expect(twice.match(/NEXU:PERSONA:BEGIN/g)?.length).toBe(1);
    expect(twice).toContain("v2 persona");
    expect(twice).not.toContain("v1 persona");
  });

  it("synthesizes content when AGENTS.md is empty", () => {
    const out = foldPersonaIntoAgents("", "solo persona");
    expect(out).toContain("solo persona");
    expect(out.trim().startsWith("<!-- NEXU:PERSONA:BEGIN -->")).toBe(true);
  });

  it("no-ops when the persona is blank", () => {
    expect(foldPersonaIntoAgents("# AGENTS", "   ")).toBe("# AGENTS");
  });
});
