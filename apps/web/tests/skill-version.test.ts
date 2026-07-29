import { compareSkillVersions, isSkillUpdateAvailable } from "@nexu/shared";
import { describe, expect, it } from "vitest";

describe("skill version comparison", () => {
  it.each([
    ["1.0.1", "1.0.0"],
    ["2.0.0", "1.99.99"],
    ["1.0.10", "1.0.9"],
    ["0.20260729.110214", "0.20260728.235959"],
    ["v3.2.0", "3.1.9"],
    ["1.0.0", "1.0.0-rc.1"],
    ["1.0.0-rc.11", "1.0.0-rc.2"],
  ])("detects %s as newer than %s", (latest, installed) => {
    expect(isSkillUpdateAvailable(latest, installed)).toBe(true);
    expect(compareSkillVersions(latest, installed)).toBe(1);
  });

  it.each([
    ["1.0.0", "1.0.0"],
    ["1.0", "1.0.0"],
    ["1.0.0+build.2", "1.0.0+build.1"],
    ["latest", "1.0.0"],
    ["2.0.0", null],
  ])("does not flag %s over %s as an update", (latest, installed) => {
    expect(isSkillUpdateAvailable(latest, installed)).toBe(false);
  });

  it("orders prerelease identifiers using SemVer rules", () => {
    expect(compareSkillVersions("1.0.0-beta.2", "1.0.0-beta.11")).toBe(-1);
    expect(compareSkillVersions("1.0.0-beta", "1.0.0-2")).toBe(1);
  });
});
