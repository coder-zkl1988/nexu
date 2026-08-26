import { describe, expect, it } from "vitest";
import { buildExperthubRoutes } from "../src/routes/experthub-routes.js";

// The ledger and the bot list live in different files and can drift. When they
// did, the experts page kept showing experts whose bots were gone — they can
// never appear in a bot picker, which is what the rest of the app selects
// from, so the install looked fine and was unusable. "Installed" has to mean
// the bot is actually there.

type Deps = Parameters<typeof buildExperthubRoutes>[0];

function buildApp(
  ledgerBotIds: Record<string, string | undefined>,
  liveBotIds: string[],
) {
  const entries = Object.fromEntries(
    Object.entries(ledgerBotIds).map(([slug, botId]) => [
      slug,
      {
        slug,
        version: "1.0.0",
        botId,
        installedAt: "2026-01-01T00:00:00.000Z",
      },
    ]),
  );
  return buildExperthubRoutes({
    catalog: {
      listExperts: async () => [],
      readLedger: async () => ({ version: 1, updatedAt: "", entries }),
      getMeta: async () => null,
    },
    installExpert: async () => ({ ok: true, botId: "x", slug: "x" }),
    createCustomExpert: async () => ({ ok: true, botId: "x", slug: "x" }),
    updateExpertSkills: async () => ({ ok: true }),
    botService: {
      deleteBot: async () => true,
      listBotIds: async () => liveBotIds,
    },
    agentsDir: "/tmp/agents",
    platformTemplatesDir: "/tmp/templates",
  } as unknown as Deps);
}

async function catalog(app: ReturnType<typeof buildApp>) {
  const res = await app.request("/catalog");
  return (await res.json()) as {
    installedSlugs: string[];
    installedExperts: Array<{ slug: string }>;
  };
}

describe("experthub catalog installed state", () => {
  it("reports an expert whose bot exists", async () => {
    const body = await catalog(buildApp({ historian: "bot-1" }, ["bot-1"]));

    expect(body.installedSlugs).toEqual(["historian"]);
  });

  it("does not report an expert whose bot is gone", async () => {
    const body = await catalog(buildApp({ historian: "bot-1" }, []));

    // The ledger still has the entry — that is exactly the drift. Reporting it
    // as installed is what hid the breakage.
    expect(body.installedSlugs).toEqual([]);
    expect(body.installedExperts).toEqual([]);
  });

  it("keeps the healthy entries when only some have lost their bots", async () => {
    const body = await catalog(
      buildApp({ historian: "bot-1", geographer: "bot-2" }, ["bot-2"]),
    );

    expect(body.installedSlugs).toEqual(["geographer"]);
  });

  it("does not report a ledger entry that never recorded a bot", async () => {
    const body = await catalog(buildApp({ historian: undefined }, ["bot-1"]));

    expect(body.installedSlugs).toEqual([]);
  });
});
