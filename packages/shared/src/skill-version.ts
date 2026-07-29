type ParsedSkillVersion = {
  core: number[];
  prerelease: Array<number | string> | null;
};

function parseSkillVersion(
  value: string | null | undefined,
): ParsedSkillVersion | null {
  const normalized = value?.trim().replace(/^v(?=\d)/i, "");
  if (!normalized) return null;

  const withoutBuild = normalized.split("+", 1)[0] ?? normalized;
  const match = /^(\d+(?:\.\d+)*)(?:-([0-9a-z.-]+))?$/i.exec(withoutBuild);
  if (!match) return null;

  const core = match[1]?.split(".").map(Number) ?? [];
  if (core.length === 0 || core.some((part) => !Number.isSafeInteger(part))) {
    return null;
  }

  const prerelease = match[2]
    ? match[2]
        .split(".")
        .map((part) =>
          /^\d+$/.test(part) && Number.isSafeInteger(Number(part))
            ? Number(part)
            : part.toLowerCase(),
        )
    : null;

  return { core, prerelease };
}

export function compareSkillVersions(
  candidate: string | null | undefined,
  current: string | null | undefined,
): -1 | 0 | 1 {
  const left = parseSkillVersion(candidate);
  const right = parseSkillVersion(current);
  if (!left || !right) return 0;

  const coreLength = Math.max(left.core.length, right.core.length);
  for (let index = 0; index < coreLength; index++) {
    const leftPart = left.core[index] ?? 0;
    const rightPart = right.core[index] ?? 0;
    if (leftPart > rightPart) return 1;
    if (leftPart < rightPart) return -1;
  }

  if (!left.prerelease && !right.prerelease) return 0;
  if (!left.prerelease) return 1;
  if (!right.prerelease) return -1;

  const prereleaseLength = Math.max(
    left.prerelease.length,
    right.prerelease.length,
  );
  for (let index = 0; index < prereleaseLength; index++) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    if (typeof leftPart === "number" && typeof rightPart === "string") {
      return -1;
    }
    if (typeof leftPart === "string" && typeof rightPart === "number") return 1;
    return leftPart > rightPart ? 1 : -1;
  }

  return 0;
}

export function isSkillUpdateAvailable(
  latestVersion: string | null | undefined,
  installedVersion: string | null | undefined,
): boolean {
  return compareSkillVersions(latestVersion, installedVersion) > 0;
}
