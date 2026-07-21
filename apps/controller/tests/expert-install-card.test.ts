import { describe, expect, it } from "vitest";
// The find-expert runtime plugin builds the A2UI install card. Import the real
// builder so this guards the actual card the chat UI renders.
import { buildInstallCard } from "../static/runtime-plugins/find-expert/index.js";

type InstallCardComponent = {
  id: string;
  type: string;
  expert?: Record<string, unknown>;
  question?: string;
};

type A2UIMessage = {
  createSurface?: {
    surfaceId: string;
    catalogId?: string;
    components?: InstallCardComponent[];
  };
  updateComponents?: {
    surfaceId: string;
    components: InstallCardComponent[];
  };
};

function parse(jsonl: string): A2UIMessage[] {
  return jsonl.split("\n").map((line) => JSON.parse(line));
}

/** Components arrive inline on createSurface (v1.0 form) or via updateComponents. */
function findComponents(messages: A2UIMessage[]): InstallCardComponent[] {
  return messages.flatMap(
    (m) => m.createSurface?.components ?? m.updateComponents?.components ?? [],
  );
}

describe("buildInstallCard", () => {
  const jsonl = buildInstallCard(
    {
      slug: "tiktok-strategist",
      name: "抖音策略师",
      emoji: "🎬",
      category: "营销部",
      description: "短视频运营专家",
      tags: ["抖音", "涨粉", "带货"],
    },
    "帮我做一套抖音涨粉策略",
  );
  const messages = parse(jsonl);

  it("creates the surface on Nexu's custom A2UI catalog", () => {
    const create = messages.find((m) => m.createSurface)?.createSurface;
    expect(create?.surfaceId).toBe("expert-install-tiktok-strategist");
    expect(create?.catalogId).toBe("https://nexu.app/a2ui/custom-catalog.json");
  });

  it("renders a single ExpertInstallCard reusing the experts-page face", () => {
    const components = findComponents(messages);
    expect(components).toHaveLength(1);
    expect(components?.[0]?.type).toBe("ExpertInstallCard");
  });

  it("passes the full expert + question so the card + delegate flow have data", () => {
    const card = findComponents(messages)[0];
    expect(card?.expert).toMatchObject({
      slug: "tiktok-strategist",
      name: "抖音策略师",
      emoji: "🎬",
      category: "营销部",
      tags: ["抖音", "涨粉", "带货"],
    });
    expect(card?.question).toBe("帮我做一套抖音涨粉策略");
  });
});
