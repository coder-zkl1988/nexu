import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const desktopMainSource = readFileSync(
  resolve(__dirname, "../../apps/desktop/main/index.ts"),
  "utf8",
);

describe("Rosetta arm64 download URL", () => {
  it("uses the current production update feed", () => {
    expect(desktopMainSource).toContain("`${R2_BASE_URL}/${channel}/arm64`");
    expect(desktopMainSource).not.toContain("https://desktop-releases.nexu.io");
  });
});
