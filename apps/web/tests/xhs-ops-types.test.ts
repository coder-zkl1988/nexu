import { describe, expect, it } from "vitest";
import {
  isRunQueued,
  normalizeBrowseDefaults,
  normalizeRunSegment,
  normalizeSchedule,
  segmentLabel,
} from "../src/lib/a2ui/custom-components/xhs-ops/xhs-ops-types";

describe("xhs-ops web normalizers (P2-3 daily segments)", () => {
  it("normalizeBrowseDefaults fills and clamps the daily target/segment fields", () => {
    expect(normalizeBrowseDefaults({})).toMatchObject({
      dailyTargetPosts: 0,
      dailySegments: 1,
    });
    expect(
      normalizeBrowseDefaults({ dailyTargetPosts: 999, dailySegments: 7 }),
    ).toMatchObject({ dailyTargetPosts: 150, dailySegments: 3 });
    expect(
      normalizeBrowseDefaults({ dailyTargetPosts: "40", dailySegments: "2" }),
    ).toMatchObject({ dailyTargetPosts: 40, dailySegments: 2 });
  });

  it("normalizeRunSegment rejects malformed segments", () => {
    expect(normalizeRunSegment({ index: 2, count: 3 })).toEqual({
      index: 2,
      count: 3,
    });
    expect(normalizeRunSegment({ index: 3, count: 2 })).toBeNull();
    expect(normalizeRunSegment({ index: 0, count: 2 })).toBeNull();
    expect(normalizeRunSegment(null)).toBeNull();
    expect(normalizeRunSegment("x")).toBeNull();
  });

  it("segmentLabel is empty for single runs", () => {
    expect(segmentLabel(null)).toBe("");
    expect(segmentLabel({ index: 1, count: 1 })).toBe("");
    expect(segmentLabel({ index: 2, count: 3 })).toBe("第 2/3 段");
  });

  it("normalizeSchedule defaults and validates HH:mm (P2-4)", () => {
    expect(normalizeSchedule(undefined)).toEqual({
      enabled: false,
      time: "10:00",
      lastTriggeredDate: null,
      lastResult: null,
    });
    expect(normalizeSchedule({ enabled: true, time: "9:30" }).time).toBe(
      "10:00",
    );
    expect(
      normalizeSchedule({
        enabled: "yes",
        time: "21:05",
        lastTriggeredDate: "2026-09-05",
        lastResult: "ok",
      }),
    ).toEqual({
      enabled: false,
      time: "21:05",
      lastTriggeredDate: "2026-09-05",
      lastResult: "ok",
    });
  });

  it("isRunQueued only for planned runs parked behind another run", () => {
    expect(isRunQueued({ status: "planned", queuedBehindRunId: "r1" })).toBe(
      true,
    );
    expect(isRunQueued({ status: "planned", queuedBehindRunId: null })).toBe(
      false,
    );
    expect(isRunQueued({ status: "running", queuedBehindRunId: "r1" })).toBe(
      false,
    );
    expect(isRunQueued(null)).toBe(false);
  });
});
