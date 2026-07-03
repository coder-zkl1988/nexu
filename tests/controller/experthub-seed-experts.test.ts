import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expertManifestSchema } from "@nexu/shared";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// tests/controller -> repoRoot -> apps/desktop/static/bundled-experts
const SEED_DIR = path.resolve(
  __dirname,
  "../../apps/desktop/static/bundled-experts",
);

describe("bundled seed experts", () => {
  it("all seed manifests parse via expertManifestSchema", async () => {
    const slugs = await readdir(SEED_DIR);
    expect(slugs.length).toBe(266);
    for (const slug of slugs) {
      const raw = await readFile(
        path.join(SEED_DIR, slug, "expert.json"),
        "utf8",
      );
      const parsed = expertManifestSchema.safeParse(JSON.parse(raw));
      expect(
        parsed.success,
        `seed ${slug} failed: ${
          !parsed.success && JSON.stringify(parsed.error.issues)
        }`,
      ).toBe(true);
      expect(parsed.success && parsed.data.slug).toBe(slug);
    }
  });

  it("includes agency imported experts and renamed security slugs", async () => {
    const slugs = (await readdir(SEED_DIR)).sort();
    expect(slugs).toContain("engineering-code-reviewer");
    expect(slugs).toContain("marketing-xiaohongshu-operator");
    expect(slugs).toContain("gis-web-gis-developer");
    expect(slugs).toContain("security-blockchain-security-auditor");
    expect(slugs).toContain("security-compliance-auditor");
    expect(slugs).not.toContain("blockchain-security-auditor");
    expect(slugs).not.toContain("compliance-auditor");
  });
});
