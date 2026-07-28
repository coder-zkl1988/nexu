import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const mainSource = readFileSync(
  resolve(__dirname, "../../apps/desktop/main/index.ts"),
  "utf8",
);
const browserManagerSource = readFileSync(
  resolve(
    __dirname,
    "../../apps/desktop/main/services/embedded-browser-manager.ts",
  ),
  "utf8",
);

describe("embedded browser webview security", () => {
  it("keeps the host bridge on the trusted app surface", () => {
    expect(mainSource).toContain("webPreferences.sandbox = false");
    expect(mainSource).toContain("Arbitrary browser pages live in sandboxed");
  });

  it("creates browser pages as sandboxed native views without Node access", () => {
    expect(browserManagerSource).toContain("new WebContentsView");
    expect(browserManagerSource).toContain("nodeIntegration: false");
    expect(browserManagerSource).toContain("contextIsolation: true");
    expect(browserManagerSource).toContain("sandbox: true");
    expect(browserManagerSource).not.toContain("preload:");
  });

  it("mounts each native browser view once instead of reordering it on show", () => {
    expect(browserManagerSource.match(/addChildView\(view\)/gu)).toHaveLength(
      1,
    );
    expect(browserManagerSource).not.toContain("addChildView(tab.view)");
  });
});
