import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const desktopMainSource = readFileSync(
  resolve(__dirname, "../../apps/desktop/main/index.ts"),
  "utf8",
);

describe("Rosetta arm64 download URL", () => {
  it("resolves the current production feed to an arm64 DMG", () => {
    expect(desktopMainSource).toContain("`${R2_BASE_URL}/${channel}/arm64`");
    expect(desktopMainSource).toContain("/releases/tabby-latest-mac-arm64.dmg");
    expect(desktopMainSource).toContain('.replace(/\\.zip$/, ".dmg")');
    expect(desktopMainSource).not.toContain("return ymlUrl");
    expect(desktopMainSource).not.toContain("https://desktop-releases.nexu.io");
  });
});
