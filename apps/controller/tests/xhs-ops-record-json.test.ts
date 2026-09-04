import { describe, expect, it } from "vitest";
import { parseRecordJson } from "../src/services/xhs-ops-task-builder.js";

const RECORD =
  '{"v":1,"mode":"search","keyword":"亲子酒店","planned":2,"browsed":2,"skipped":2,"interactions":{"like":0,"collect":0,"follow":0},"anomalies":[],"posts":[{"title":"自驾1h直达","author":"未知","action":"none","commentsRead":3}],"observation":"结果以图文酒店测评为主"}';

describe("parseRecordJson tolerance (first real-device run findings)", () => {
  it("finds the marker when the phone escaped newlines as literal backslash-n", () => {
    // 实测：GLM 把整段汇报的换行写成字面 \n，RECORD_JSON: 不在真实行首。
    const message = `小红书任务已完成。\\n\\n浏览2篇。\\n\\nRECORD_JSON:${RECORD}`;
    const parsed = parseRecordJson(message);
    expect(parsed?.browsed).toBe(2);
    expect(parsed?.keyword).toBe("亲子酒店");
  });

  it("ignores the machine receipt line appended after the record", () => {
    const message = `汇报。\nRECORD_JSON:${RECORD}\n[回执] 各应用生效点击: com.xingin.xhs=11`;
    expect(parseRecordJson(message)?.browsed).toBe(2);
  });

  it("still parses the plain contract shape", () => {
    expect(parseRecordJson(`汇报\nRECORD_JSON:${RECORD}`)?.posts).toHaveLength(
      1,
    );
  });

  it("returns null without a marker", () => {
    expect(parseRecordJson("已浏览 2/2；没有结构化记录")).toBeNull();
  });
});

// ─── P1-2: 人设进任务头 ─────────────────────────────────────────────────────
import {
  buildSearchChunkTask,
  formatPersona,
} from "../src/services/xhs-ops-task-builder.js";

describe("persona in the phone task header (P1-2)", () => {
  const base = {
    label: "豆豆妈的周末计划",
    positioning: "用产品经理思维做零踩坑周末遛娃攻略",
    dwellSecMin: 10,
    dwellSecMax: 25,
    quota: {
      like: { enabled: false, max: 0 },
      collect: { enabled: false, max: 0 },
      follow: { enabled: false, max: 0 },
    },
  };

  it("formatPersona joins the non-empty demographics with ·", () => {
    expect(
      formatPersona({
        age: "32岁",
        gender: "女",
        region: "北京海淀",
        occupation: "互联网产品经理",
        lifeStatus: "2岁娃新手妈妈",
      }),
    ).toBe("32岁·女·北京海淀·互联网产品经理·2岁娃新手妈妈");
    expect(
      formatPersona({
        age: "",
        gender: " 女 ",
        region: "",
        occupation: "",
        lifeStatus: "",
      }),
    ).toBe("女");
    expect(formatPersona(null)).toBe("");
  });

  it("header carries 人设 when present and omits the segment when empty", () => {
    const withPersona = buildSearchChunkTask({
      ...base,
      persona: "32岁·女·北京海淀",
      keyword: "亲子酒店",
      count: 2,
    });
    expect(withPersona.split("\n")[0]).toBe(
      "【小红书内容研究任务｜账号定位：豆豆妈的周末计划｜人设：32岁·女·北京海淀｜用产品经理思维做零踩坑周末遛娃攻略】",
    );
    const without = buildSearchChunkTask({
      ...base,
      keyword: "亲子酒店",
      count: 2,
    });
    expect(without.split("\n")[0]).toBe(
      "【小红书内容研究任务｜账号定位：豆豆妈的周末计划｜用产品经理思维做零踩坑周末遛娃攻略】",
    );
  });
});
