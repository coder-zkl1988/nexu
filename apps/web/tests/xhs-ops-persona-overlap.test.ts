import { describe, expect, it } from "vitest";
import {
  type PersonaOverlapInput,
  findPersonaOverlaps,
} from "../src/lib/a2ui/custom-components/xhs-ops/xhs-ops-types";

function row(
  key: string,
  label: string,
  persona: Partial<PersonaOverlapInput["persona"]> = {},
  core: string[] = [],
): PersonaOverlapInput {
  return {
    key,
    label,
    persona: {
      age: "",
      gender: "",
      region: "",
      occupation: "",
      lifeStatus: "",
      ...persona,
    },
    interestPool: { core, extended: [], general: [] },
  };
}

describe("findPersonaOverlaps (P1-3 人设差异检查)", () => {
  it("flags duplicate labels on both rows", () => {
    const out = findPersonaOverlaps([row("a", "豆豆妈"), row("b", " 豆豆妈 ")]);
    expect(out.get("a")).toEqual(["账号定位名与「豆豆妈」重复"]);
    expect(out.get("b")).toEqual(["账号定位名与「豆豆妈」重复"]);
  });

  it("flags identical region+occupation only when both are filled", () => {
    const out = findPersonaOverlaps([
      row("a", "A", { region: "北京海淀", occupation: "互联网产品经理" }),
      row("b", "B", { region: "北京海淀", occupation: "互联网产品经理" }),
      row("c", "C", { region: "", occupation: "互联网产品经理" }),
    ]);
    expect(out.get("a")?.[0]).toContain("地区+职业与「B」相同");
    expect(out.get("b")?.[0]).toContain("地区+职业与「A」相同");
    expect(out.has("c")).toBe(false);
  });

  it("flags identical age+gender+lifeStatus", () => {
    const out = findPersonaOverlaps([
      row("a", "A", { age: "32岁", gender: "女", lifeStatus: "2岁娃新手妈妈" }),
      row("b", "B", { age: "32岁", gender: "女", lifeStatus: "2岁娃新手妈妈" }),
    ]);
    expect(out.get("a")).toEqual(["年龄/性别/生活状态与「B」完全相同"]);
  });

  it("flags core-interest overlap at or above 60% Jaccard and reports the percentage", () => {
    const out = findPersonaOverlaps([
      row("a", "A", {}, ["亲子酒店", "周末遛娃", "带娃攻略"]),
      row("b", "B", {}, ["亲子酒店", "咖啡", "摄影"]), // 与 A 1/5=20%、与 C 1/6≈17% → 不告警
      row("c", "C", {}, ["亲子酒店", "周末遛娃", "带娃攻略", "周边游"]), // 与 A 3/4 = 75%
    ]);
    expect(out.get("a")).toEqual(["核心兴趣与「C」重叠 75%"]);
    expect(out.get("c")).toEqual(["核心兴趣与「A」重叠 75%"]);
    expect(out.has("b")).toBe(false);
  });

  it("the ten personas the agent actually produced pass clean", () => {
    const rows = [
      row(
        "1",
        "晚晚的遛娃筹备清单",
        {
          age: "33岁",
          gender: "女",
          region: "北京朝阳",
          occupation: "互联网运营",
          lifeStatus: "5岁娃妈妈",
        },
        ["亲子酒店", "周末遛娃"],
      ),
      row(
        "2",
        "BiuBiu的玩中学周末",
        {
          age: "29岁",
          gender: "女",
          region: "北京海淀",
          occupation: "教育行业课程顾问",
          lifeStatus: "3岁娃妈妈",
        },
        ["周末遛娃", "带娃攻略"],
      ),
      row(
        "3",
        "二孩爸爸大鱼哥",
        {
          age: "36岁",
          gender: "男",
          region: "北京西城",
          occupation: "金融分析师",
          lifeStatus: "二孩爸爸",
        },
        ["亲子酒店", "周边游"],
      ),
      row(
        "4",
        "安安妈妈的性价比遛娃",
        {
          age: "31岁",
          gender: "女",
          region: "北京丰台",
          occupation: "小学老师",
          lifeStatus: "2岁娃妈妈",
        },
        ["带娃攻略", "周边游"],
      ),
    ];
    expect(findPersonaOverlaps(rows).size).toBe(0);
  });
});
