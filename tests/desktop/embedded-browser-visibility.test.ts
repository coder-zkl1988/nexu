import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The browser view may only be shown by the panel.
 *
 * A `WebContentsView` the main process puts on screen itself has no address
 * bar, no tabs and no header: it lands as a raw page pasted over the app that
 * the user can neither navigate nor dismiss. That shipped once, as a fallback
 * for agent clicks when no panel was hosting the view — and it did not even
 * work, because a click into a view the main process placed is swallowed.
 *
 * Source-level because the alternative needs a running Electron window; the
 * invariant is narrow enough that reading the file states it plainly.
 */

const managerSource = readFileSync(
  path.join(
    __dirname,
    "../../apps/desktop/main/services/embedded-browser-manager.ts",
  ),
  "utf8",
);

describe("embedded browser visibility", () => {
  it("never turns a view visible outside the panel's show path", () => {
    const shown = [...managerSource.matchAll(/setVisible\(([^)]*)\)/g)].map(
      (match) => match[1]?.trim(),
    );

    // `false` is always fine; the only truthy case is the show handler picking
    // which of the window's tabs is frontmost.
    const truthy = shown.filter((argument) => argument !== "false");
    expect(truthy).toEqual(["candidate === tab"]);
  });

  it("keeps the offscreen viewport helper from placing a view on screen", () => {
    // Bounds are still assigned before a view is shown so a snapshot measures
    // the page at a plausible size. That must stay paired with visible=false.
    expect(managerSource).toContain("offscreenLayoutBounds");
    expect(managerSource).not.toContain("agentFallbackBounds");
    expect(managerSource).not.toContain("revealAgentTab");
  });
});
