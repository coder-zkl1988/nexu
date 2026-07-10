import type { MinimalExpert } from "@nexu/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ExpertInstallCard } from "../src/lib/a2ui/custom-components/ExpertInstallCard";
import type { CustomComponentProps } from "../src/lib/a2ui/custom-components/registry";

// ExpertInstallCard reuses ExpertCardFace from expert-card.tsx; that module also
// exports ExpertCard, which pulls the catalog hooks. None run when rendering the
// face, but stub them so the module graph loads without app providers.
vi.mock("@/hooks/use-experthub-catalog", () => ({
  useInstallExpert: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUninstallExpert: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const expert: MinimalExpert = {
  slug: "tiktok-strategist",
  name: "抖音策略师",
  emoji: "🎬",
  category: "营销部",
  description: "短视频运营专家，擅长涨粉与带货。",
  tags: ["抖音", "涨粉"],
  version: "1.0.0",
  author: "nexu",
};

function renderCard(): string {
  const props = {
    comp: {
      id: "install-card",
      type: "ExpertInstallCard",
      expert,
      question: "帮我做一套抖音涨粉策略",
    },
    resolve: <T,>(v: T) => v,
    onAction: () => {},
  } as unknown as CustomComponentProps;
  return renderToStaticMarkup(<ExpertInstallCard {...props} />);
}

describe("ExpertInstallCard", () => {
  const markup = renderCard();

  it("renders the experts-page card face (name, category, description, tags)", () => {
    expect(markup).toContain("抖音策略师");
    expect(markup).toContain("短视频运营专家");
    expect(markup).toContain("营销部");
    expect(markup).toContain("抖音");
  });

  it("offers confirm + cancel actions for the user to approve install", () => {
    expect(markup).toContain("安装并调用");
    expect(markup).toContain("取消");
  });
});
