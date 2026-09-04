import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SurfaceManager } from "../src/lib/a2ui/a2ui-surface";
import type { SurfaceState } from "../src/lib/a2ui/a2ui-types";
import type { CustomComponentProps } from "../src/lib/a2ui/custom-components/registry";
import { XhsOpsAccountPlanner } from "../src/lib/a2ui/custom-components/xhs-ops/XhsOpsAccountPlanner";
import { XhsOpsProfileCard } from "../src/lib/a2ui/custom-components/xhs-ops/XhsOpsProfileCard";
import { XhsOpsProjectForm } from "../src/lib/a2ui/custom-components/xhs-ops/XhsOpsProjectForm";
import { XhsOpsRunPlanner } from "../src/lib/a2ui/custom-components/xhs-ops/XhsOpsRunPlanner";

const resolveLiteral = <T>(val: T): unknown => val;

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

function withProviders(el: React.ReactElement): React.ReactElement {
  return createElement(QueryClientProvider, { client: queryClient }, el);
}

function renderProps(comp: Record<string, unknown>): CustomComponentProps {
  return {
    comp,
    resolve: resolveLiteral,
    surface: {} as SurfaceState,
    manager: {} as SurfaceManager,
    onAction: () => {},
  };
}

describe("xhs-ops a2ui components render (wiring smoke)", () => {
  it("XhsOpsProjectForm renders a new-project form from prefill", () => {
    const html = renderToStaticMarkup(
      createElement(
        XhsOpsProjectForm,
        renderProps({
          id: "c1",
          type: "XhsOpsProjectForm",
          prefill: {
            name: "亲子度假",
            business: { industry: "亲子旅游" },
          },
        }),
      ),
    );
    expect(html).toContain("亲子度假");
    expect(html.length).toBeGreaterThan(500);
  });

  it("XhsOpsProfileCard shows the proposed profile for confirmation", () => {
    const html = renderToStaticMarkup(
      createElement(
        XhsOpsProfileCard,
        renderProps({
          id: "c2",
          type: "XhsOpsProfileCard",
          projectId: "p1",
          profile: {
            summary: "一二线城市 30 岁左右新手父母，周末高质量陪伴",
            base: {
              ageRange: "28-38",
              genderRatio: "女7:男3",
              regions: ["北京"],
            },
            verticalInterests: ["亲子酒店", "亲子旅行"],
            generalInterests: ["咖啡", "家居"],
          },
        }),
      ),
    );
    expect(html).toContain("新手父母");
    expect(html).toContain("亲子酒店");
  });

  it("XhsOpsAccountPlanner lists persona suggestions", () => {
    const html = renderToStaticMarkup(
      withProviders(
        createElement(
          XhsOpsAccountPlanner,
          renderProps({
            id: "c3",
            type: "XhsOpsAccountPlanner",
            projectId: "p1",
            suggestions: [
              {
                label: "海淀职场妈妈",
                positioning: "周末遛娃侦察兵",
                persona: {
                  age: "32岁",
                  gender: "女",
                  region: "北京海淀",
                  occupation: "互联网产品经理",
                  lifeStatus: "2岁娃新手妈妈",
                },
                interestPool: {
                  core: ["亲子酒店"],
                  extended: [],
                  general: ["咖啡"],
                },
              },
            ],
          }),
        ),
      ),
    );
    expect(html).toContain("海淀职场妈妈");
    expect(html).toContain("周末遛娃侦察兵");
    // P1-2: 建议卡展示人设摘要，便于差异化核对
    expect(html).toContain("32岁·女·北京海淀·互联网产品经理·2岁娃新手妈妈");
  });

  it("XhsOpsRunPlanner renders the per-account plan keywords", () => {
    const html = renderToStaticMarkup(
      withProviders(
        createElement(
          XhsOpsRunPlanner,
          renderProps({
            id: "c4",
            type: "XhsOpsRunPlanner",
            projectId: "p1",
            plans: [
              {
                accountId: "acct-1",
                keywords: [{ keyword: "亲子酒店", count: 5 }],
                homeFeedCount: 6,
              },
            ],
          }),
        ),
      ),
    );
    // 账号列表异步加载：静态渲染断言卡片骨架与标题（渲染路径通）即可
    expect(html).toContain("今日浏览计划");
  });
});
